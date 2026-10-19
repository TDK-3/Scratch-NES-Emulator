#!/usr/bin/env python3
"""Bring the compiled Scratch project in line with the ported GoboScript sources.

The GoboScript compiler needs Cargo and rustc, which are not available here, so the
compiled project in scratch/scratch.sb3 is patched block by block to match what the
sources say:

* the CPU bus honours the per-device attachment flags,
* the CPU keeps an optional bus-access log,
* the shared-vector replay detaches the devices the TypeScript reference replays without,
* the 6502 interrupt vectors sit at the top of the address space,
* the frame loop runs the console in bounded chunks,
* the console boots the embedded image and runs it.

Every patch is mechanical: it rewrites existing blocks or adds the blocks the sources
declare. The result is verified by running the project headlessly; see
docs/TESTING.md for what that run shows.

Usage:
    python3 scripts/align_compiled_scratch_project.py [source.sb3] [target.sb3]
"""
import json
import os
import pathlib
import sys
import zipfile

REPOSITORY_ROOT = pathlib.Path(__file__).resolve().parent.parent
SOURCE = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else REPOSITORY_ROOT / "scratch" / "scratch.sb3"
TARGET = pathlib.Path(sys.argv[2]) if len(sys.argv) > 2 else REPOSITORY_ROOT / "scratch" / "scratch.sb3"

# The 6502 interrupt vectors, and the wrong values the compiled project still carries.
VECTOR_ADDRESSES = {
    65476: 65530,
    65477: 65531,
    65484: 65532,
    65485: 65533,
    65494: 65534,
    65495: 65535,
}


class Ids:
    """Hands out block ids that are unique across the project."""

    def __init__(self):
        self.counter = 0

    def new(self):
        self.counter += 1
        return f"$patch{self.counter}#"


class Target:
    """One Scratch target and the block surgery it needs."""

    def __init__(self, target, ids):
        self.target = target
        self.blocks = target["blocks"]
        self.variables = target["variables"]
        self.ids = ids

    # ---- inputs -------------------------------------------------------------

    @staticmethod
    def lit(value):
        return [1, [4, value]]

    @staticmethod
    def text(value):
        return [1, [10, value]]

    @staticmethod
    def var(name):
        return [3, [12, name, name], [10, ""]]

    @staticmethod
    def ref(block_id):
        return [2, block_id]

    # ---- blocks -------------------------------------------------------------

    def block(self, opcode, inputs=None, fields=None, mutation=None, parent=None,
              next_block=None, shadow=False, top=False, extra=None):
        block_id = self.ids.new()
        block = {
            "opcode": opcode,
            "next": next_block,
            "parent": parent,
            "topLevel": top,
            "shadow": shadow,
            "inputs": inputs or {},
        }
        if fields is not None:
            block["fields"] = fields
        if mutation is not None:
            block["mutation"] = mutation
        if extra:
            block.update(extra)
        self.blocks[block_id] = block
        return block_id

    def reporter(self, opcode, inputs, parent=None):
        return self.block(opcode, inputs, parent=parent)

    def equals(self, left, right, parent=None):
        return self.reporter("operator_equals", {"OPERAND1": left, "OPERAND2": right}, parent)

    def and_(self, left, right, parent=None):
        return self.reporter("operator_and", {"OPERAND1": left, "OPERAND2": right}, parent)

    def or_(self, left, right, parent=None):
        return self.reporter("operator_or", {"OPERAND1": left, "OPERAND2": right}, parent)

    def not_(self, operand, parent=None):
        return self.reporter("operator_not", {"OPERAND": operand}, parent)

    def add(self, left, right, parent=None):
        return self.reporter("operator_add", {"NUM1": left, "NUM2": right}, parent)

    def join(self, left, right, parent=None):
        return self.reporter("operator_join", {"STRING1": left, "STRING2": right}, parent)

    def join_chain(self, parts):
        """Joins the parts right-associatively, the way the `&` operator nests."""
        result = parts[-1]
        for index in range(len(parts) - 2, -1, -1):
            right = result if index == len(parts) - 2 else self.ref(result)
            result = self.join(parts[index], right)
        return result

    def set_var(self, name, value_input, next_block=None, parent=None):
        return self.block(
            "data_setvariableto",
            {"VALUE": value_input},
            fields={"VARIABLE": [name, name]},
            next_block=next_block,
            parent=parent,
        )

    def call(self, proccode, inputs=None, next_block=None, parent=None, argument_ids=None):
        mutation = {
            "tagName": "mutation",
            "children": [],
            "warp": "true",
            "proccode": proccode,
            "argumentids": json.dumps(argument_ids if argument_ids is not None else []),
        }
        return self.block(
            "procedures_call",
            inputs or {},
            mutation=mutation,
            next_block=next_block,
            parent=parent,
        )

    def if_(self, condition_block, body_ids, parent=None, next_block=None):
        if not body_ids:
            return self.block(
                "control_if",
                {"CONDITION": self.ref(condition_block)},
                parent=parent,
                next_block=next_block,
            )
        block_id = self.block(
            "control_if",
            {"CONDITION": self.ref(condition_block), "SUBSTACK": self.ref(body_ids[0])},
            parent=parent,
            next_block=next_block,
        )
        self.blocks[condition_block]["parent"] = block_id
        self.set_chain(body_ids, block_id)
        return block_id

    def if_else(self, condition_block, body_ids, else_ids, parent=None, next_block=None):
        inputs = {"CONDITION": self.ref(condition_block)}
        if body_ids:
            inputs["SUBSTACK"] = self.ref(body_ids[0])
        if else_ids:
            inputs["SUBSTACK2"] = self.ref(else_ids[0])
        block_id = self.block("control_if_else", inputs, parent=parent, next_block=next_block)
        self.blocks[condition_block]["parent"] = block_id
        if body_ids:
            self.set_chain(body_ids, block_id)
        if else_ids:
            self.set_chain(else_ids, block_id)
        return block_id

    def forever(self, body_ids, parent=None, next_block=None):
        block_id = self.block(
            "control_forever",
            {"SUBSTACK": self.ref(body_ids[0])},
            parent=parent,
            next_block=next_block,
        )
        self.set_chain(body_ids, block_id)
        return block_id

    def wait(self, duration, parent=None, next_block=None):
        return self.block(
            "control_wait",
            {"DURATION": self.lit(duration)},
            parent=parent,
            next_block=next_block,
        )

    def broadcast(self, message, parent=None, next_block=None):
        return self.block(
            "event_broadcast",
            {"BROADCAST_INPUT": [1, [11, message, message]]},
            parent=parent,
            next_block=next_block,
        )

    def say(self, message_input, parent=None, next_block=None):
        return self.block(
            "looks_say",
            {"MESSAGE": message_input},
            parent=parent,
            next_block=next_block,
        )

    # ---- chains -------------------------------------------------------------

    def set_chain(self, block_ids, parent):
        for index, block_id in enumerate(block_ids):
            self.blocks[block_id]["parent"] = parent
            self.blocks[block_id]["next"] = block_ids[index + 1] if index + 1 < len(block_ids) else None

    def chain(self, first):
        block_ids = []
        current = first
        while current:
            block_ids.append(current)
            current = self.blocks[current].get("next")
        return block_ids

    def prepend_to_body(self, proccode, new_id):
        """Puts a block at the front of a proc body."""
        definition = self.definition(proccode)
        first = self.blocks[definition].get("next")
        self.blocks[new_id]["parent"] = definition
        self.blocks[new_id]["next"] = first
        if first is not None:
            self.blocks[first]["parent"] = new_id
        self.blocks[definition]["next"] = new_id

    def insert_after(self, block_ids, anchor_id, new_id):
        """Puts a block right after the anchor block."""
        for index, block_id in enumerate(block_ids):
            if block_id != anchor_id:
                continue
            following = block_ids[index + 1] if index + 1 < len(block_ids) else None
            self.blocks[new_id]["parent"] = self.blocks[anchor_id]["parent"]
            self.blocks[new_id]["next"] = following
            if following is not None:
                self.blocks[following]["parent"] = new_id
            self.blocks[anchor_id]["next"] = new_id
            return
        raise KeyError(f"{anchor_id} is not in the chain")

    def replace_in_chain(self, block_ids, old_id, new_id):
        for index, block_id in enumerate(block_ids):
            if block_id != old_id:
                continue
            if index > 0:
                self.blocks[block_ids[index - 1]]["next"] = new_id
                self.blocks[new_id]["parent"] = self.blocks[block_ids[index - 1]]["parent"]
            else:
                self.blocks[new_id]["parent"] = self.blocks[old_id]["parent"]
            following = block_ids[index + 1] if index + 1 < len(block_ids) else None
            self.blocks[new_id]["next"] = following
            if following is not None:
                self.blocks[following]["parent"] = new_id
            return
        raise KeyError(f"{old_id} is not in the chain")

    # ---- procedures ---------------------------------------------------------

    def proccodes(self):
        return {
            block_id: block["mutation"]["proccode"]
            for block_id, block in self.blocks.items()
            if block.get("opcode") == "procedures_prototype"
        }

    def definition(self, proccode):
        codes = self.proccodes()
        for block_id, block in self.blocks.items():
            if block.get("opcode") != "procedures_definition":
                continue
            prototype = block["inputs"]["custom_block"][1]
            if codes.get(prototype) == proccode:
                return block_id
        raise KeyError(f"procedure {proccode} is missing")

    def body(self, proccode):
        return self.chain(self.blocks[self.definition(proccode)].get("next"))

    def add_proc(self, proccode, body_ids, warp=True, y=None):
        """Adds a custom block with the given body and returns its definition id."""
        prototype_id = self.ids.new()
        definition_id = self.ids.new()
        argument_id = self.ids.new()

        self.blocks[prototype_id] = {
            "opcode": "procedures_prototype",
            "next": None,
            "parent": definition_id,
            "topLevel": False,
            "shadow": True,
            "inputs": {},
            "mutation": {
                "tagName": "mutation",
                "children": [],
                "warp": "true" if warp else "false",
                "proccode": proccode,
                "argumentids": json.dumps([argument_id]),
                "argumentnames": json.dumps([proccode.split(" ")[0]]),
                "argumentdefaults": json.dumps([""]),
            },
        }
        self.blocks[definition_id] = {
            "opcode": "procedures_definition",
            "next": body_ids[0] if body_ids else None,
            "parent": None,
            "topLevel": True,
            "shadow": False,
            "inputs": {"custom_block": [1, prototype_id]},
            "x": 880,
            "y": y if y is not None else 400000,
        }
        if body_ids:
            self.set_chain(body_ids, definition_id)
        return definition_id

    # ---- condition helpers --------------------------------------------------

    def condition_of(self, if_id):
        return self.blocks[self.blocks[if_id]["inputs"]["CONDITION"][1]]["opcode"]

    def condition_id(self, if_id):
        return self.blocks[if_id]["inputs"]["CONDITION"][1]

    def condition_block(self, if_id):
        return self.blocks[self.condition_id(if_id)]

    def compares_to(self, if_id, opcode, operand, variable=None):
        condition = self.condition_block(if_id)
        if condition.get("opcode") != opcode:
            return False
        if condition["inputs"].get("OPERAND2") != self.lit(operand):
            return False
        if variable is not None:
            return condition["inputs"].get("OPERAND1") == self.var(variable)
        return True

    def remove_from_chain(self, proccode, block_id):
        """Takes a block out of a proc body and leaves the rest of the chain in place."""
        body = self.body(proccode)
        index = body.index(block_id)
        previous = body[index - 1] if index > 0 else None
        following = body[index + 1] if index + 1 < len(body) else None
        parent = self.blocks[block_id]["parent"]

        if previous is None:
            self.definition(proccode)["next"] = following
        else:
            self.blocks[previous]["next"] = following

        if following is not None:
            self.blocks[following]["parent"] = parent

        body[index] = following
        del self.blocks[block_id]
        return body


def patch_bus_reset(stage):
    """The bus reset also drops a pending OAM DMA transfer, like NesCpuBus.reset()."""
    body = stage.body("cpu_bus_reset")
    anchor = None
    for block_id in body:
        block = stage.blocks[block_id]
        if block.get("opcode") != "data_setvariableto":
            continue
        if block.get("fields", {}).get("VARIABLE", [None])[0] == "cpu_bus_cycle_count":
            anchor = block_id
    if anchor is None:
        raise KeyError("the cycle counter of cpu_bus_reset is missing")

    additions = [
        stage.set_var("cpu_dma_phase", stage.lit(0)),
        stage.set_var("cpu_dma_index", stage.lit(0)),
        stage.set_var("cpu_dma_data_latch", stage.lit(0)),
        stage.set_var("cpu_dma_sequence_cycle", stage.lit(0)),
        stage.set_var("cpu_dma_alignment_cycle_needed", stage.lit(0)),
    ]
    for block_id in additions:
        stage.insert_after(body, anchor, block_id)
        body.insert(body.index(anchor) + 1, block_id)
        anchor = block_id


def patch_bus_read(stage):
    """The PPU window only answers while the PPU is attached.

    The window keeps its own address bound, and the attachment check guards the register
    read inside it, so a detached PPU leaves the window undriven and a cartridge address
    is never answered by the PPU.
    """
    body = stage.body("cpu_bus_read address: %s")
    window = None
    for block_id in body:
        if stage.blocks[block_id].get("opcode") != "control_if":
            continue
        if stage.compares_to(block_id, "operator_lt", 16384, "cpu_bus_read:numeric_address"):
            window = block_id
    if window is None:
        raise KeyError("the PPU window of cpu_bus_read is missing")

    substack = stage.blocks[window]["inputs"]["SUBSTACK"][1]
    inner = None
    for block_id in stage.chain(substack):
        block = stage.blocks[block_id]
        if block.get("opcode") != "control_if":
            continue
        condition = stage.condition_block(block_id)
        if condition.get("opcode") == "operator_or":
            inner = block_id
    if inner is None:
        raise KeyError("the PPU register check of cpu_bus_read is missing")

    chain = stage.chain(substack)
    index = chain.index(inner)
    wrapped = chain[: index + 1]
    following = chain[index + 1] if index + 1 < len(chain) else None

    condition = stage.equals(stage.var("cpu_bus_ppu_attached"), stage.lit(1))
    new_if = stage.block(
        "control_if",
        {"CONDITION": stage.ref(condition), "SUBSTACK": stage.ref(wrapped[0])},
        parent=window,
    )
    stage.blocks[condition]["parent"] = new_if
    stage.set_chain(wrapped, new_if)
    stage.blocks[new_if]["next"] = following
    if following is not None:
        stage.blocks[following]["parent"] = new_if
    stage.blocks[window]["inputs"]["SUBSTACK"] = [2, new_if]


def patch_bus_read_io(stage):
    """The APU and the controller ports only answer while they are attached."""
    body = stage.body("cpu_bus_read_io address: %s")
    guards = {
        16405: "cpu_bus_apu_attached",
        16406: "cpu_bus_controllers_attached",
        16407: "cpu_bus_controllers_attached",
    }

    for block_id in body:
        if stage.blocks[block_id].get("opcode") != "control_if":
            continue
        for address, flag in guards.items():
            if not stage.compares_to(block_id, "operator_equals", address):
                continue
            condition = stage.condition_id(block_id)
            guard = stage.equals(stage.var(flag), stage.lit(1))
            combined = stage.and_(stage.ref(condition), stage.ref(guard))
            stage.blocks[block_id]["inputs"]["CONDITION"] = stage.ref(combined)
            stage.blocks[condition]["parent"] = combined
            stage.blocks[guard]["parent"] = combined


def patch_bus_write(stage):
    """The PPU window, the APU registers, and the controller port follow their flags."""
    proccode = "cpu_bus_write address: %s value: %s"
    body = stage.body(proccode)
    ppu_window = None
    controller = None
    ram = None

    for block_id in body:
        block = stage.blocks[block_id]
        if block.get("opcode") != "control_if":
            continue
        if stage.compares_to(block_id, "operator_lt", 16384, "cpu_bus_write:numeric_address"):
            ppu_window = block_id
        elif stage.compares_to(block_id, "operator_lt", 8192, "cpu_bus_write:numeric_address"):
            ram = block_id
        elif stage.compares_to(block_id, "operator_equals", 16406, "cpu_bus_write:numeric_address"):
            controller = block_id

    if ppu_window is None or controller is None or ram is None:
        raise KeyError("the cpu_bus_write windows are missing")

    # The RAM window is decoded before the PPU window, so a RAM write never reaches a
    # PPU register. The compiler lowers `if`/`elif` into a nested `control_if_else`.
    ram_condition = stage.condition_id(ram)
    ppu_condition = stage.condition_id(ppu_window)
    ram_body = stage.chain(stage.blocks[ram]["inputs"]["SUBSTACK"][1])
    ppu_body = stage.chain(stage.blocks[ppu_window]["inputs"]["SUBSTACK"][1])

    # The PPU register writes only happen while the PPU is attached.
    attached = stage.equals(stage.var("cpu_bus_ppu_attached"), stage.lit(1))
    guard = stage.if_(attached, ppu_body)
    inner = stage.if_else(ppu_condition, [guard], [])
    outer = stage.if_else(ram_condition, ram_body, [inner])

    # The nested pair takes the place of the two old windows.
    stage.replace_in_chain(body, ppu_window, outer)
    body[body.index(ppu_window)] = outer
    body = stage.remove_from_chain(proccode, ram)
    del stage.blocks[ppu_window]

    # The controller port only latches while the controllers are attached.
    condition = stage.condition_id(controller)
    guard = stage.equals(stage.var("cpu_bus_controllers_attached"), stage.lit(1))
    combined = stage.and_(stage.ref(condition), stage.ref(guard))
    stage.blocks[controller]["inputs"]["CONDITION"] = stage.ref(combined)
    stage.blocks[condition]["parent"] = combined
    stage.blocks[guard]["parent"] = combined

    # The APU registers: $4000-$4013, $4015, and $4017.
    apu_write = stage.call(
        "apu_write_register address: %s value: %s",
        {
            "address": stage.var("cpu_bus_write:numeric_address"),
            "value": stage.var("cpu_bus_write:numeric_value"),
        },
        argument_ids=["address", "value"],
    )
    in_range = stage.and_(
        stage.ref(stage.not_(stage.ref(stage.reporter("operator_lt", {
            "OPERAND1": stage.var("cpu_bus_write:numeric_address"),
            "OPERAND2": stage.lit(16384),
        })))),
        stage.ref(stage.not_(stage.ref(stage.reporter("operator_gt", {
            "OPERAND1": stage.var("cpu_bus_write:numeric_address"),
            "OPERAND2": stage.lit(16403),
        })))),
    )
    status_or_frame = stage.or_(
        stage.ref(stage.equals(stage.var("cpu_bus_write:numeric_address"), stage.lit(16405))),
        stage.ref(stage.equals(stage.var("cpu_bus_write:numeric_address"), stage.lit(16407))),
    )
    inner = stage.if_else(
        in_range,
        [apu_write],
        [stage.if_else(status_or_frame, [stage.call(
            "apu_write_register address: %s value: %s",
            {
                "address": stage.var("cpu_bus_write:numeric_address"),
                "value": stage.var("cpu_bus_write:numeric_value"),
            },
            argument_ids=["address", "value"],
        )], [])],
    )
    attached = stage.equals(stage.var("cpu_bus_apu_attached"), stage.lit(1))
    apu_branch = stage.if_(attached, [inner])
    stage.insert_after(body, outer, apu_branch)


def patch_access_log(stage):
    """The bus-access log is only written while the trace is enabled."""
    for proccode in ["cpu_read_cycle address: %s", "cpu_write_cycle address: %s value: %s"]:
        body = stage.body(proccode)
        additions = [block_id for block_id in body if stage.blocks[block_id].get("opcode") == "data_addtolist"]
        if len(additions) != 3:
            raise KeyError(f"{proccode} does not log three values")
        index = body.index(additions[0])
        wrapped = body[index: index + 3]
        following = body[index + 3] if index + 3 < len(body) else None

        condition = stage.equals(stage.var("cpu_access_log_enabled"), stage.lit(1))
        new_if = stage.block(
            "control_if",
            {"CONDITION": stage.ref(condition), "SUBSTACK": stage.ref(wrapped[0])},
            parent=stage.blocks[wrapped[0]]["parent"],
        )
        stage.blocks[condition]["parent"] = new_if
        stage.set_chain(wrapped, new_if)
        stage.blocks[new_if]["next"] = following
        if following is not None:
            stage.blocks[following]["parent"] = new_if
        if index > 0:
            stage.blocks[body[index - 1]]["next"] = new_if
        else:
            stage.definition(proccode)["next"] = new_if


def patch_vector_addresses(stage):
    """The 6502 interrupt vectors live at the top of the address space."""
    for block in stage.blocks.values():
        for value in block.get("inputs", {}).values():
            if isinstance(value, list) and len(value) >= 2 and value[0] == 1:
                literal = value[1]
                if isinstance(literal, list) and literal and literal[0] == 4 and literal[1] in VECTOR_ADDRESSES:
                    value[1] = [4, VECTOR_ADDRESSES[literal[1]]]


def add_detach_proc(stage):
    """Adds the proc that detaches every device from the CPU bus."""
    body = [
        stage.set_var("cpu_bus_ppu_attached", stage.lit(0)),
        stage.set_var("cpu_bus_apu_attached", stage.lit(0)),
        stage.set_var("cpu_bus_controllers_attached", stage.lit(0)),
        stage.set_var("cpu_bus_cartridge_kind", stage.lit(0)),
    ]
    stage.add_proc("port_detach_bus_devices", body, y=410000)
    return "port_detach_bus_devices"


def patch_handlers(stage):
    """The record handlers detach the devices the reference replays without."""
    for proccode in [
        "run_bus_vector input_start: %s",
        "run_cpu_addressing_vector operation: %s input_start: %s",
        "run_cpu_sequence_vector operation: %s input_start: %s",
        "run_cpu_instruction_vector input_start: %s",
        "run_cpu_control_vector input_start: %s",
        "run_cartridge_bus_vector input_start: %s",
    ]:
        call = stage.call("port_detach_bus_devices")
        stage.prepend_to_body(proccode, call)


def patch_bus_vector_operation(stage):
    """The bus suite replays its operation 2 records with live controller ports."""
    definition = stage.definition("run_bus_vector input_start: %s")
    prototype = stage.blocks[definition]["inputs"]["custom_block"][1]

    argument = stage.block(
        "argument_reporter_string_number",
        fields={"VALUE": ["operation", None]},
        shadow=True,
        parent=prototype,
    )
    stage.blocks[prototype]["inputs"]["operation"] = stage.ref(argument)
    stage.blocks[prototype]["mutation"]["argumentids"] = json.dumps(["operation", "input_start"])
    stage.blocks[prototype]["mutation"]["argumentnames"] = json.dumps(["operation", "input_start"])
    stage.blocks[prototype]["mutation"]["argumentdefaults"] = json.dumps(["", ""])

    body = stage.body("run_bus_vector input_start: %s")
    condition = stage.equals(stage.ref(argument), stage.lit(2))
    attach = stage.set_var("cpu_bus_controllers_attached", stage.lit(1))
    branch = stage.if_(condition, [attach])

    # The reattach happens after the controller ports are set up, the way the source does it.
    setup = [block_id for block_id in body if stage.blocks[block_id].get("opcode") == "procedures_call"]
    stage.insert_after(body, setup[-1], branch)

    # The dispatcher hands the operation to the handler.
    for block in stage.blocks.values():
        if block.get("opcode") != "procedures_call":
            continue
        if block.get("mutation", {}).get("proccode") != "run_bus_vector input_start: %s":
            continue
        block["inputs"]["operation"] = stage.var("run_next_port_vector:operation")
        block["mutation"]["argumentids"] = json.dumps(["operation", "input_start"])


def patch_self_test_trace(stage):
    """The self test turns the bus-access log on before it replays the records."""
    enable = stage.set_var("cpu_access_log_enabled", stage.lit(1))
    stage.prepend_to_body("run_port_self_test", enable)


def patch_frame_loop_irq(stage):
    """The APU and the board drive one IRQ line, the way the console composes them."""
    body = stage.body("frame_loop_run_chunk")
    target = None
    for block_id in body:
        block = stage.blocks[block_id]
        if block.get("opcode") not in ("control_if", "control_if_else"):
            continue
        condition = stage.condition_block(block_id)
        if condition.get("opcode") != "operator_equals":
            continue
        operand = condition["inputs"].get("OPERAND1")
        if operand == stage.var("apu_is_irq_asserted:return"):
            target = block_id
    if target is None:
        raise KeyError("the APU IRQ check of frame_loop_run_chunk is missing")

    board_call = stage.call("cartridge_board_irq_line")
    original = stage.condition_id(target)
    combined = stage.or_(
        stage.ref(original),
        stage.ref(stage.equals(stage.var("cartridge_board_irq_line:return"), stage.lit(1))),
    )
    stage.blocks[target]["inputs"]["CONDITION"] = stage.ref(combined)
    stage.blocks[combined]["parent"] = target
    stage.blocks[original]["parent"] = combined

    # The board's IRQ line is read before the check that uses it.
    stage.blocks[board_call]["parent"] = stage.blocks[target]["parent"]
    stage.blocks[board_call]["next"] = target
    stage.blocks[target]["parent"] = board_call
    stage.replace_in_chain(body, target, board_call)


def add_frame_loop(stage):
    """Adds the frame loop the console runs.

    The compiled project was built before the GoboScript sources grew the frame loop, so the
    loop is added here block by block. It matches `scratch/src/frame_loop.gs` except that the
    APU is not clocked: the compiled project has no APU clocking either, and the APU only
    drives the CPU through its frame IRQ, which the console leaves low.
    """
    stage.variables["ppu_clock_cpu_cycle:return"] = ["ppu_clock_cpu_cycle:return", 0]
    stage.variables["apu_is_irq_asserted:return"] = ["apu_is_irq_asserted:return", 0]
    stage.variables["cartridge_board_irq_line:return"] = ["cartridge_board_irq_line:return", 0]

    # ppu_clock_cpu_cycle: three PPU dots for one CPU cycle.
    stage.add_proc(
        "ppu_clock_cpu_cycle",
        [
            stage.call("ppu_clock_ppu_dot"),
            stage.call("ppu_clock_ppu_dot"),
            stage.call("ppu_clock_ppu_dot"),
        ],
        y=450000,
    )

    # apu_is_irq_asserted: the frame IRQ or the DMC IRQ.
    apu_irq = stage.reporter(
        "operator_or",
        {
            "OPERAND1": stage.ref(stage.not_(stage.ref(stage.equals(stage.var("apu_frame_irq"), stage.lit(0))))),
            "OPERAND2": stage.ref(stage.not_(stage.ref(stage.equals(stage.var("dmc_irq"), stage.lit(0))))),
        },
    )
    stage.add_proc(
        "apu_is_irq_asserted",
        [stage.set_var("apu_is_irq_asserted:return", stage.ref(apu_irq))],
        y=460000,
    )

    # cartridge_board_irq_line: an attached MMC3 board drives the line.
    board_call = stage.call("mmc3_get_irq_line_asserted")
    board_body = [
        stage.set_var("cartridge_board_irq_line:return", stage.var("mmc3_get_irq_line_asserted:return")),
    ]
    stage.add_proc(
        "cartridge_board_irq_line",
        [
            stage.if_else(
                stage.equals(stage.var("cpu_bus_cartridge_kind"), stage.lit(2)),
                [board_call, board_body[0]],
                [stage.set_var("cartridge_board_irq_line:return", stage.lit(0))],
            ),
        ],
        y=470000,
    )

    # frame_loop_reset
    stage.add_proc(
        "frame_loop_reset",
        [
            stage.set_var("frame_loop_cycles_run", stage.lit(0)),
            stage.set_var("frame_loop_frame_complete", stage.lit(0)),
            stage.set_var("frame_loop_chunk_cycles_run", stage.lit(0)),
        ],
        y=480000,
    )

    # frame_loop_check_dma: the DMA runs until the bus reports it is finished, which is one
    # call when no transfer is pending. The bound keeps a stuck transfer from hanging.
    dma_body = stage.if_else(
        stage.equals(stage.var("cpu_clock_dma_cycle:return"), stage.lit(0)),
        [stage.set_var("frame_loop_dma_done", stage.lit(1))],
        [
            stage.set_var(
                "frame_loop_dma_cycles",
                stage.ref(stage.add(stage.var("frame_loop_dma_cycles"), stage.lit(1))),
            ),
            stage.if_(
                stage.not_(stage.ref(stage.reporter("operator_lt", {
                    "OPERAND1": stage.var("frame_loop_dma_cycles"),
                    "OPERAND2": stage.lit(520),
                }))),
                [stage.set_var("frame_loop_dma_done", stage.lit(1))],
            ),
        ],
    )
    stage.add_proc(
        "frame_loop_check_dma",
        [
            stage.set_var("frame_loop_dma_cycles", stage.lit(0)),
            stage.set_var("frame_loop_dma_done", stage.lit(0)),
            stage.block(
                "control_repeat_until",
                {
                    "CONDITION": stage.ref(stage.equals(stage.var("frame_loop_dma_done"), stage.lit(1))),
                    "SUBSTACK": stage.ref(dma_body),
                },
            ),
        ],
        y=490000,
    )

    # frame_loop_run_chunk
    dma_cycles = [
        stage.set_var(
            "frame_loop_cycles_run",
            stage.ref(stage.add(stage.var("frame_loop_cycles_run"), stage.var("frame_loop_dma_cycles"))),
        ),
        stage.set_var(
            "frame_loop_chunk_cycles_run",
            stage.ref(stage.add(stage.var("frame_loop_chunk_cycles_run"), stage.var("frame_loop_dma_cycles"))),
        ),
        stage.block(
            "control_repeat",
            {
                "TIMES": stage.var("frame_loop_dma_cycles"),
                "SUBSTACK": stage.ref(stage.call("ppu_clock_cpu_cycle")),
            },
        ),
    ]

    sequence = [
        stage.set_var("frame_loop_cycles_before", stage.var("cpu_cycles")),
        stage.call("cpu_begin_next_sequence"),
        stage.set_var("frame_loop_cycles_after", stage.var("cpu_cycles")),
        stage.set_var(
            "frame_loop_sequence_cycles",
            stage.ref(stage.reporter("operator_subtract", {
                "NUM1": stage.var("frame_loop_cycles_after"),
                "NUM2": stage.var("frame_loop_cycles_before"),
            })),
        ),
        stage.set_var(
            "frame_loop_cycles_run",
            stage.ref(stage.add(stage.var("frame_loop_cycles_run"), stage.var("frame_loop_sequence_cycles"))),
        ),
        stage.set_var(
            "frame_loop_chunk_cycles_run",
            stage.ref(stage.add(stage.var("frame_loop_chunk_cycles_run"), stage.var("frame_loop_sequence_cycles"))),
        ),
        stage.block(
            "control_repeat",
            {
                "TIMES": stage.var("frame_loop_sequence_cycles"),
                "SUBSTACK": stage.ref(stage.call("ppu_clock_cpu_cycle")),
            },
        ),
        stage.call("ppu_take_nmi_edge"),
        stage.if_(
            stage.equals(stage.var("ppu_take_nmi_edge:return"), stage.lit(1)),
            [stage.call("cpu_request_nmi")],
        ),
        stage.call("apu_is_irq_asserted"),
        stage.call("cartridge_board_irq_line"),
        stage.if_else(
            stage.or_(
                stage.ref(stage.equals(stage.var("apu_is_irq_asserted:return"), stage.lit(1))),
                stage.ref(stage.equals(stage.var("cartridge_board_irq_line:return"), stage.lit(1))),
            ),
            [stage.call("cpu_set_irq_line", {"asserted": stage.lit(1)})],
            [stage.call("cpu_set_irq_line", {"asserted": stage.lit(0)})],
        ),
    ]

    inner = stage.if_else(
        stage.equals(stage.var("frame_loop_dma_cycles"), stage.lit(0)),
        sequence,
        dma_cycles,
    )
    check = stage.if_(
        stage.not_(stage.ref(stage.reporter("operator_lt", {
            "OPERAND1": stage.var("frame_loop_cycles_run"),
            "OPERAND2": stage.lit(29780),
        }))),
        [stage.set_var("frame_loop_frame_complete", stage.lit(1))],
    )
    else_body = [
        stage.call("frame_loop_check_dma"),
        inner,
    ]
    # The chunk runs until it covered a thousand CPU cycles, or until the frame ended.
    chunk_done = stage.or_(
        stage.ref(stage.not_(stage.ref(stage.reporter("operator_lt", {
            "OPERAND1": stage.var("frame_loop_chunk_cycles_run"),
            "OPERAND2": stage.lit(100),
        })))),
        stage.ref(stage.equals(stage.var("frame_loop_frame_complete"), stage.lit(1))),
    )
    body = [
        stage.set_var("frame_loop_chunk_cycles_run", stage.lit(0)),
        stage.block(
            "control_repeat_until",
            {
                "CONDITION": stage.ref(chunk_done),
                "SUBSTACK": stage.ref(stage.if_else(
                    stage.not_(stage.ref(stage.reporter("operator_lt", {
                        "OPERAND1": stage.var("frame_loop_cycles_run"),
                        "OPERAND2": stage.lit(29780),
                    }))),
                    [stage.set_var("frame_loop_frame_complete", stage.lit(1))],
                    else_body,
                )),
            },
        ),
        check,
    ]
    stage.add_proc("frame_loop_run_chunk", body, y=500000)


def add_rom_run(stage):
    """Adds the procs that boot the embedded image and run it."""
    # rom_run_start
    start_body = [
        stage.set_var("rom_run_started", stage.lit(0)),
        stage.set_var("rom_run_frame_count", stage.lit(0)),
        stage.set_var("rom_run_cycles", stage.lit(0)),
        stage.set_var("rom_run_state_text", stage.text("not started")),
        stage.set_var("cpu_bus_ppu_attached", stage.lit(1)),
        stage.set_var("cpu_bus_apu_attached", stage.lit(1)),
        stage.set_var("cpu_bus_controllers_attached", stage.lit(1)),
        stage.call("cartridge_load_board"),
    ]

    booted = [
        stage.call("cpu_bus_reset"),
        stage.call("cpu_bus_clear_ram"),
        stage.call("cpu_reset_registers"),
        stage.call("cpu_clear_interrupt_state"),
        stage.call("controller_reset"),
        stage.call("frame_loop_reset"),
        stage.set_var("cpu_access_log_enabled", stage.lit(0)),
        stage.call("cpu_execute_reset_cycles"),
        stage.set_var("rom_run_started", stage.lit(1)),
        stage.set_var(
            "rom_run_state_text",
            stage.ref(stage.join_chain([
                stage.text("running "),
                stage.var("cartridge_board_state_text"),
            ])),
        ),
    ]
    failed = [
        stage.set_var(
            "rom_run_state_text",
            stage.ref(stage.join_chain([
                stage.text("boot failed "),
                stage.var("cartridge_board_state_text"),
            ])),
        ),
    ]
    start_body.append(stage.if_else(
        stage.equals(stage.var("cartridge_board_attached"), stage.lit(1)),
        booted,
        failed,
    ))
    stage.add_proc("rom_run_start", start_body, y=420000)

    # rom_run_update_status
    status_body = [
        stage.if_(
            stage.equals(stage.var("rom_run_started"), stage.lit(1)),
            [
                stage.set_var(
                    "rom_run_state_text",
                    stage.ref(stage.join_chain([
                        stage.text("test_rom.nes frame "),
                        stage.var("rom_run_frame_count"),
                        stage.text(" cycles "),
                        stage.var("rom_run_cycles"),
                        stage.text(" pc "),
                        stage.var("cpu_program_counter"),
                        stage.text(" "),
                        stage.var("cartridge_board_state_text"),
                    ])),
                ),
            ],
        ),
    ]
    stage.add_proc("rom_run_update_status", status_body, y=430000)

    # rom_run_loop
    loop_body = [
        stage.call("frame_loop_run_chunk"),
        stage.set_var(
            "rom_run_cycles",
            stage.ref(stage.add(stage.var("rom_run_cycles"), stage.var("frame_loop_chunk_cycles_run"))),
        ),
    ]
    frame = [
        stage.call("frame_loop_reset"),
        stage.set_var(
            "rom_run_frame_count",
            stage.ref(stage.add(stage.var("rom_run_frame_count"), stage.lit(1))),
        ),
    ]
    loop_body.append(stage.if_(
        stage.equals(stage.var("frame_loop_frame_complete"), stage.lit(1)),
        frame,
    ))
    loop_body.append(stage.call("rom_run_update_status"))
    loop_body.append(stage.wait(0))
    stage.add_proc("rom_run_loop", [stage.forever(loop_body)], warp=False, y=440000)


def patch_stage_script(stage):
    """The green flag runs the self test, boots the console, and keeps it running."""
    body = stage.body("run_port_self_test")
    hat = None
    for block_id, block in stage.blocks.items():
        if block.get("opcode") == "event_whenflagclicked" and block.get("topLevel"):
            hat = block_id
    if hat is None:
        raise KeyError("the green flag script is missing")

    script = stage.chain(hat)
    last = script[-1]
    boot = stage.call("rom_run_start", parent=stage.blocks[last]["parent"], next_block=None)
    announce = stage.broadcast("rom run started", parent=stage.blocks[last]["parent"], next_block=None)
    loop = stage.call("rom_run_loop", parent=stage.blocks[last]["parent"], next_block=None)
    stage.blocks[last]["next"] = boot
    stage.blocks[boot]["next"] = announce
    stage.blocks[announce]["next"] = loop


def patch_sprite_script(sprite):
    """The display sprite reports the console's status."""
    hat = None
    for block_id, block in sprite.blocks.items():
        if block.get("opcode") == "event_whenflagclicked" and block.get("topLevel"):
            hat = block_id
    if hat is None:
        raise KeyError("the sprite's green flag script is missing")

    script = sprite.chain(hat)
    last = script[-1]

    report = sprite.if_(
        sprite.equals(sprite.var("rom_run_started"), sprite.lit(1)),
        [sprite.say(sprite.var("rom_run_state_text"))],
    )
    # The loop hangs off the end of the green flag script, so it runs: a Scratch script
    # only executes the blocks the hat reaches through the `next` chain.
    loop = sprite.forever([sprite.wait(0.5), report], parent=sprite.blocks[last]["parent"])
    sprite.blocks[last]["next"] = loop
    sprite.blocks[loop]["parent"] = sprite.blocks[last]["parent"]

    # The sprite says the status when the console boots.
    message = sprite.block(
        "event_whenbroadcastreceived",
        fields={"BROADCAST_OPTION": ["rom run started", "rom run started"]},
        top=True,
        extra={"x": 200, "y": 200},
    )
    say = sprite.say(sprite.var("rom_run_state_text"), parent=message)
    sprite.blocks[message]["next"] = say


def already_aligned(stage) -> bool:
    """Reports whether the project already carries the patches this script applies.

    The PPU window of the CPU bus is the tell: an aligned project has the attachment
    check inside the window, and an unaligned one answers every address with the PPU.
    """
    for block_id in stage.body("cpu_bus_read address: %s"):
        block = stage.blocks[block_id]
        if block.get("opcode") != "control_if":
            continue
        if not stage.compares_to(block_id, "operator_lt", 16384, "cpu_bus_read:numeric_address"):
            continue
        substack = block["inputs"]["SUBSTACK"][1]
        for inner_id in stage.chain(substack):
            inner = stage.blocks[inner_id]
            if inner.get("opcode") != "control_if":
                continue
            condition = stage.condition_block(inner_id)
            if condition.get("opcode") != "operator_equals":
                continue
            operands = condition.get("inputs", {})
            return "cpu_bus_ppu_attached" in str(operands)
    return False


def main():
    with zipfile.ZipFile(SOURCE) as archive:
        names = archive.namelist()
        files = {name: archive.read(name) for name in names}

    project = json.loads(files["project.json"])
    ids = Ids()
    stage_target = next(target for target in project["targets"] if target.get("isStage"))
    sprite_target = next(target for target in project["targets"] if not target.get("isStage"))
    stage = Target(stage_target, ids)
    sprite = Target(sprite_target, ids)

    if already_aligned(stage):
        print(f"{SOURCE} is already aligned with the sources; nothing to do")
        return

    for name, value in {
        "cpu_bus_ppu_attached": 1,
        "cpu_bus_apu_attached": 1,
        "cpu_bus_controllers_attached": 1,
        "cpu_access_log_enabled": 1,
        "rom_run_started": 0,
        "rom_run_frame_count": 0,
        "rom_run_cycles": 0,
        "rom_run_state_text": "",
    }.items():
        stage.variables[name] = [name, value]

    patch_vector_addresses(stage)
    patch_bus_reset(stage)
    patch_bus_read(stage)
    patch_bus_read_io(stage)
    patch_bus_write(stage)
    patch_access_log(stage)
    add_detach_proc(stage)
    patch_handlers(stage)
    patch_bus_vector_operation(stage)
    patch_self_test_trace(stage)
    add_frame_loop(stage)
    add_rom_run(stage)
    patch_stage_script(stage)
    patch_sprite_script(sprite)

    if os.path.exists(TARGET):
        os.remove(TARGET)
    with zipfile.ZipFile(TARGET, "w", zipfile.ZIP_DEFLATED) as archive:
        for name in names:
            if name == "project.json":
                archive.writestr(name, json.dumps(project))
            else:
                archive.writestr(name, files[name])

    print(f"wrote {TARGET}")


if __name__ == "__main__":
    main()
