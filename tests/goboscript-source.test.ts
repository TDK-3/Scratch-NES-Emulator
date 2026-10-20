import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { CPU_INSTRUCTION_PORTED_MNEMONICS } from "./support/cpu_instruction_projection.js";
import { CPU_CONTROL_SEQUENCE_KINDS } from "./support/cpu_control_projection.js";
import { cpu_mnemonic_ids, opcode_table_fixture } from "./support/cpu_opcode_projection.js";
import { MMC3_OPS, NROM_MEMORY_OPS } from "./support/mapper_projection.js";
import * as ported from "./support/goboscript_port_algorithms.js";
import { shared_port_fixture } from "./support/shared_port_vectors.js";

/**
 * Source-level checks for the GoboScript project in scratch/.
 *
 * The pinned GoboScript compiler needs Cargo and rustc, which are unavailable here, so these
 * sources cannot be compiled. This file enforces the rules that are knowable without the
 * compiler: the syntax shape the upstream grammar accepts, the constructs that make the
 * upstream compiler panic, name collisions with Scratch's builtin block shapes, the project's
 * indentation and ASCII rules, and the contract that keeps the .gs algorithms in step with
 * their TypeScript mirrors and with the shared vector fixture.
 */

const SCRATCH_DIRECTORY = fileURLToPath(new URL("../scratch/", import.meta.url));
const MAX_LINE_COLUMNS = 120;
const INDENT_WIDTH = 4;

/** Reserved words from the upstream lexer's token table (src/lexer/token.rs, compiler 3.x). */
const GOBOSCRIPT_KEYWORDS: readonly string[] = [
    "abs", "acos", "add", "and", "antiln", "antilog", "as", "asin", "at", "atan", "ceil", "cloud", "cos", "costumes",
    "delete", "elif", "else", "enum", "false", "floor", "forever", "func", "hide", "if", "in", "insert", "length",
    "list", "ln", "local", "log", "not", "nowarp", "on", "onbackdrop", "onclick", "onclone", "onflag", "onkey",
    "onloudness", "ontimer", "or", "point_in_direction", "proc", "repeat", "return", "round", "set_size", "set_volume",
    "set_x", "set_y", "set_rotation_style_all_around", "set_rotation_style_do_not_rotate",
    "set_rotation_style_left_right", "show", "sin", "sounds", "sqrt", "struct", "tan", "to", "true", "until", "var",
];

/**
 * The top-level declarations the upstream grammar accepts in a `Sprite = Declr*` file. A line
 * that matches none of them is a bare statement, which the parser rejects.
 */
const TOP_LEVEL_DECLARATIONS: readonly RegExp[] = [
    /^%include \S+$/,
    /^%define \S+ .+$/,
    /^%undef \S+$/,
    /^costumes .*;$/,
    /^sounds .*;$/,
    /^(nowarp )?proc \w+( .*)? \{$/,
    /^func \w+\(.*\) \{$/,
    /^var \w+( =.*)?;$/,
    /^cloud \w+( =.*)?;$/,
    /^list \w+( .*)?;$/,
    /^enum \w+ \{$/,
    /^struct \w+ \{$/,
    /^onflag \{$/,
    /^on ".+" \{$/,
    /^onkey ".+" \{$/,
    /^onclick \{$/,
    /^onbackdrop ".+" \{$/,
    /^onclone \{$/,
    /^onloudness > .+ \{$/,
    /^ontimer > .+ \{$/,
    /^hide;$/,
    /^show;$/,
    /^set_x .+;$/,
    /^set_y .+;$/,
    /^set_size .+;$/,
    /^set_volume .+;$/,
    /^point_in_direction .+;$/,
    /^set_rotation_style_\w+ .+;$/,
    /^;$/,
    /^\}$/,
];

/**
 * Builtin block and reporter shapes from the upstream `Block::from_shape` and
 * `Repr::from_shape` tables. A proc or func whose name and arity match one of these is
 * compiled into the builtin block instead of a custom block.
 */
const SCRATCH_BLOCK_NAMES: readonly string[] = [
    "answer", "ask", "backdrop_name", "backdrop_number", "broadcast", "broadcast_and_wait", "change_brightness_effect",
    "change_color_effect", "change_fisheye_effect", "change_ghost_effect", "change_mosaic_effect",
    "change_pan_effect", "change_pen_brightness", "change_pen_hue", "change_pen_saturation", "change_pen_size",
    "change_pen_transparency", "change_pitch_effect", "change_pixelate_effect", "change_size", "change_tempo",
    "change_volume", "change_whirl_effect", "change_x", "change_y", "clear_graphic_effects", "clear_sound_effects",
    "clone", "color_is_touching_color", "contains", "costume_name", "costume_number", "current_date",
    "current_day_of_week", "current_hour", "current_minute", "current_month", "current_second", "current_year",
    "days_since_2000", "delete_this_clone", "direction", "distance_to", "distance_to_mouse_pointer", "erase_all",
    "glide", "glide_to_mouse_pointer", "glide_to_random_position", "go_backward", "go_forward", "goto", "goto_back",
    "goto_front", "goto_mouse_pointer", "goto_random_position", "hide", "if_on_edge_bounce", "key_pressed", "loudness",
    "mouse_down", "mouse_x", "mouse_y", "move", "next_backdrop", "next_costume", "online", "pen_down", "pen_up",
    "play_drum", "play_note", "play_sound_until_done", "point_in_direction", "point_towards",
    "point_towards_mouse_pointer", "point_towards_random_direction", "previous_backdrop", "random",
    "random_backdrop", "reset_timer", "rest", "say", "set_brightness_effect", "set_color_effect",
    "set_drag_mode_draggable", "set_drag_mode_not_draggable", "set_fisheye_effect", "set_ghost_effect",
    "set_instrument", "set_mosaic_effect", "set_pan_effect", "set_pen_brightness", "set_pen_color", "set_pen_hue",
    "set_pen_saturation", "set_pen_size", "set_pen_transparency", "set_pitch_effect", "set_pixelate_effect",
    "set_rotation_style_all_around", "set_rotation_style_do_not_rotate", "set_rotation_style_left_right", "set_size",
    "set_tempo", "set_volume", "set_whirl_effect", "set_x", "set_y", "show", "size", "stamp", "start_sound",
    "stop_all", "stop_all_sounds", "stop_other_scripts", "stop_this_script", "switch_backdrop", "switch_costume",
    "think", "timer", "touching", "touching_color", "touching_edge", "touching_mouse_pointer", "turn_left",
    "turn_right", "username", "volume", "wait", "x_position", "y_position",
];

/** Headers whose algorithms must stay mirrored in tests/support/goboscript_port_algorithms.ts. */
const MIRRORED_HEADERS: readonly string[] = [
    "src/cartridge.gs",
    "src/controller.gs",
    "src/cpu_addressing.gs",
    "src/cpu_alu.gs",
    "src/cpu_bus.gs",
    "src/cpu_core.gs",
    "src/cpu_instruction.gs",
    "src/cpu_opcode.gs",
    "src/cpu_sequence.gs",
    "src/cpu_status.gs",
    "src/numeric.gs",
];

interface GsDeclaration {
    readonly kind: "proc" | "func" | "var" | "list" | "enum";
    readonly name: string;
    readonly args: readonly string[];
    readonly warp: boolean;
    readonly body: readonly string[];
    readonly line: number;
}

interface GsEnum {
    readonly name: string;
    readonly variants: ReadonlyMap<string, number>;
}

interface GsSource {
    readonly path: string;
    readonly text: string;
    readonly lines: readonly string[];
    readonly declarations: readonly GsDeclaration[];
    readonly enums: readonly GsEnum[];
    readonly includes: readonly string[];
}

/**
 * The parity contract between the GoboScript sources and their TypeScript mirror. A `mirror`
 * of null means the declaration is deliberately not mirrored, and `reason` says why.
 */
const MIRROR_CONTRACT: readonly {
    readonly source: string;
    readonly declaration: string;
    readonly mirror: string | null;
    readonly reason?: string;
}[] = [
    { source: "src/numeric.gs", declaration: "to_number", mirror: "to_number" },
    { source: "src/numeric.gs", declaration: "normalize_byte", mirror: "normalize_byte" },
    { source: "src/numeric.gs", declaration: "normalize_word", mirror: "normalize_word" },
    { source: "src/numeric.gs", declaration: "to_signed_byte", mirror: "to_signed_byte" },
    { source: "src/numeric.gs", declaration: "byte_high", mirror: "byte_high" },
    { source: "src/numeric.gs", declaration: "byte_low", mirror: "byte_low" },
    { source: "src/numeric.gs", declaration: "join_bytes", mirror: "join_bytes" },
    { source: "src/numeric.gs", declaration: "bit_at", mirror: "bit_at" },
    { source: "src/numeric.gs", declaration: "bitwise_and", mirror: "bitwise_and" },
    { source: "src/numeric.gs", declaration: "bitwise_or", mirror: "bitwise_or" },
    { source: "src/numeric.gs", declaration: "bitwise_xor", mirror: "bitwise_xor" },
    {
        source: "src/bitwise_tables.gs",
        declaration: "bitwise_table_init",
        mirror: null,
        reason: "fills the 256-entry nibble AND table the bitwise helpers index; the mirror builds that table at load",
    },
    { source: "src/cpu_status.gs", declaration: "normalize_status", mirror: "normalize_status" },
    { source: "src/cpu_status.gs", declaration: "has_status_flag", mirror: "has_status_flag" },
    { source: "src/cpu_status.gs", declaration: "set_status_flag", mirror: "set_status_flag" },
    {
        source: "src/cpu_status.gs",
        declaration: "update_zero_negative_flags",
        mirror: "update_zero_negative_flags",
    },
    { source: "src/cpu_status.gs", declaration: "pack_status_for_stack", mirror: "pack_status_for_stack" },
    { source: "src/cpu_status.gs", declaration: "unpack_status_from_stack", mirror: "unpack_status_from_stack" },
    { source: "src/cpu_alu.gs", declaration: "alu_add_with_carry", mirror: "alu_add_with_carry" },
    { source: "src/cpu_alu.gs", declaration: "alu_subtract_with_carry", mirror: "alu_subtract_with_carry" },
    { source: "src/cpu_alu.gs", declaration: "alu_and", mirror: "alu_and" },
    { source: "src/cpu_alu.gs", declaration: "alu_ora", mirror: "alu_ora" },
    { source: "src/cpu_alu.gs", declaration: "alu_eor", mirror: "alu_eor" },
    { source: "src/cpu_alu.gs", declaration: "alu_shift_left", mirror: "alu_shift_left" },
    { source: "src/cpu_alu.gs", declaration: "alu_shift_right", mirror: "alu_shift_right" },
    { source: "src/cpu_alu.gs", declaration: "alu_rotate_left", mirror: "alu_rotate_left" },
    { source: "src/cpu_alu.gs", declaration: "alu_rotate_right", mirror: "alu_rotate_right" },
    { source: "src/cpu_alu.gs", declaration: "alu_compare", mirror: "alu_compare" },
    { source: "src/cpu_alu.gs", declaration: "alu_bit_test", mirror: "alu_bit_test" },
    { source: "src/cpu_alu.gs", declaration: "alu_increment", mirror: "alu_increment" },
    { source: "src/cpu_alu.gs", declaration: "alu_decrement", mirror: "alu_decrement" },
    { source: "src/controller.gs", declaration: "controller_reset", mirror: "GoboscriptControllerPorts.reset" },
    {
        source: "src/controller.gs",
        declaration: "controller_set_button_mask",
        mirror: "GoboscriptControllerPorts.set_button_mask",
    },
    {
        source: "src/controller.gs",
        declaration: "controller_serial_read",
        mirror: "GoboscriptControllerPorts.serial_read",
    },
    {
        source: "src/controller.gs",
        declaration: "controller_write_strobe",
        mirror: "GoboscriptControllerPorts.write_strobe",
    },
    { source: "src/cpu_bus.gs", declaration: "cpu_bus_reset", mirror: "GoboscriptCpuBus.reset" },
    { source: "src/cpu_bus.gs", declaration: "cpu_apply_driven_value", mirror: "GoboscriptCpuBus.apply_driven_value" },
    { source: "src/cpu_bus.gs", declaration: "cpu_bus_read", mirror: "GoboscriptCpuBus.read" },
    { source: "src/cpu_bus.gs", declaration: "cpu_bus_read_io", mirror: "GoboscriptCpuBus.read_io" },
    { source: "src/cpu_bus.gs", declaration: "cpu_bus_write", mirror: "GoboscriptCpuBus.write" },
    { source: "src/cpu_bus.gs", declaration: "cpu_clock_dma_cycle", mirror: "GoboscriptCpuBus.clock_dma_cycle" },
    { source: "src/cpu_bus.gs", declaration: "cpu_bus_clear_ram", mirror: "GoboscriptCpuBus.clear_ram" },
    {
        source: "src/cpu_core.gs",
        declaration: "cpu_reset_cycle_accounting",
        mirror: "GoboscriptCpuCore.reset_cycle_accounting",
    },
    { source: "src/cpu_core.gs", declaration: "cpu_reset_registers", mirror: "GoboscriptCpuCore.reset_registers" },
    { source: "src/cpu_core.gs", declaration: "cpu_read_cycle", mirror: "GoboscriptCpuCore.read_cycle" },
    { source: "src/cpu_core.gs", declaration: "cpu_write_cycle", mirror: "GoboscriptCpuCore.write_cycle" },
    { source: "src/cpu_core.gs", declaration: "cpu_dummy_read_cycle", mirror: "GoboscriptCpuCore.dummy_read_cycle" },
    { source: "src/cpu_core.gs", declaration: "cpu_fetch_byte", mirror: "GoboscriptCpuCore.fetch_byte" },
    { source: "src/cpu_core.gs", declaration: "cpu_fetch_word", mirror: "GoboscriptCpuCore.fetch_word" },
    { source: "src/cpu_core.gs", declaration: "cpu_push_byte", mirror: "GoboscriptCpuCore.push_byte" },
    { source: "src/cpu_core.gs", declaration: "cpu_pop_byte", mirror: "GoboscriptCpuCore.pop_byte" },
    { source: "src/cpu_core.gs", declaration: "cpu_push_word", mirror: "GoboscriptCpuCore.push_word" },
    { source: "src/cpu_core.gs", declaration: "cpu_pop_word", mirror: "GoboscriptCpuCore.pop_word" },
    { source: "src/cpu_core.gs", declaration: "cpu_push_status", mirror: "GoboscriptCpuCore.push_status" },
    {
        source: "src/cpu_core.gs",
        declaration: "cpu_restore_status_from_stack",
        mirror: "GoboscriptCpuCore.restore_status_from_stack",
    },
    { source: "src/cpu_addressing.gs", declaration: "cpu_page_crossed", mirror: "GoboscriptCpuCore.page_crossed" },
    {
        source: "src/cpu_addressing.gs",
        declaration: "cpu_indexed_dummy_address",
        mirror: "GoboscriptCpuCore.indexed_dummy_address",
    },
    { source: "src/cpu_addressing.gs", declaration: "cpu_reset_operand", mirror: "GoboscriptCpuCore.reset_operand" },
    {
        source: "src/cpu_addressing.gs",
        declaration: "cpu_set_memory_operand",
        mirror: "GoboscriptCpuCore.set_memory_operand",
    },
    {
        source: "src/cpu_addressing.gs",
        declaration: "cpu_resolve_operand",
        mirror: "GoboscriptCpuCore.resolve_operand",
    },
    {
        source: "src/cpu_instruction.gs",
        declaration: "cpu_reset_instruction_error",
        mirror: "GoboscriptCpuCore.reset_instruction_error",
    },
    {
        source: "src/cpu_instruction.gs",
        declaration: "cpu_fetch_and_decode_opcode",
        mirror: "GoboscriptCpuCore.fetch_and_decode_opcode",
    },
    {
        source: "src/cpu_instruction.gs",
        declaration: "cpu_execute_branch",
        mirror: "GoboscriptCpuCore.execute_branch",
    },
    {
        source: "src/cpu_instruction.gs",
        declaration: "cpu_execute_jump",
        mirror: "GoboscriptCpuCore.execute_jump",
    },
    {
        source: "src/cpu_instruction.gs",
        declaration: "cpu_execute_regular_instruction",
        mirror: "GoboscriptCpuCore.execute_regular_instruction",
    },
    {
        source: "src/cpu_instruction.gs",
        declaration: "cpu_apply_read_instruction",
        mirror: "GoboscriptCpuCore.apply_read_instruction",
    },
    {
        source: "src/cpu_instruction.gs",
        declaration: "cpu_execute_memory_instruction",
        mirror: "GoboscriptCpuCore.execute_memory_instruction",
    },
    {
        source: "src/cpu_instruction.gs",
        declaration: "cpu_compute_store_value",
        mirror: "GoboscriptCpuCore.compute_store_value",
    },
    {
        source: "src/cpu_instruction.gs",
        declaration: "cpu_modify_value",
        mirror: "GoboscriptCpuCore.modify_value",
    },
    {
        source: "src/cpu_instruction.gs",
        declaration: "cpu_apply_implied_instruction",
        mirror: "GoboscriptCpuCore.apply_implied_instruction",
    },
    {
        source: "src/cpu_instruction.gs",
        declaration: "cpu_execute_instruction",
        mirror: "GoboscriptCpuCore.execute_instruction",
    },
    {
        source: "src/cpu_opcode.gs",
        declaration: "cpu_reset_opcode_decode",
        mirror: "GoboscriptCpuOpcodeDecoder.reset_decode",
    },
    {
        source: "src/cpu_opcode.gs",
        declaration: "cpu_check_opcode_table",
        mirror: "GoboscriptCpuOpcodeDecoder.check_table",
    },
    {
        source: "src/cpu_opcode.gs",
        declaration: "cpu_decode_opcode",
        mirror: "GoboscriptCpuOpcodeDecoder.decode",
    },
    {
        source: "src/cpu_sequence.gs",
        declaration: "cpu_reset_sequence_error",
        mirror: "GoboscriptCpuCore.reset_sequence_error",
    },
    {
        source: "src/cpu_sequence.gs",
        declaration: "cpu_execute_reset_cycles",
        mirror: "GoboscriptCpuCore.execute_reset_cycles",
    },
    {
        source: "src/cpu_sequence.gs",
        declaration: "cpu_execute_brk_cycles",
        mirror: "GoboscriptCpuCore.execute_brk_cycles",
    },
    {
        source: "src/cpu_sequence.gs",
        declaration: "cpu_execute_jsr_cycles",
        mirror: "GoboscriptCpuCore.execute_jsr_cycles",
    },
    {
        source: "src/cpu_sequence.gs",
        declaration: "cpu_execute_rti_cycles",
        mirror: "GoboscriptCpuCore.execute_rti_cycles",
    },
    {
        source: "src/cpu_sequence.gs",
        declaration: "cpu_execute_rts_cycles",
        mirror: "GoboscriptCpuCore.execute_rts_cycles",
    },
    {
        source: "src/cpu_sequence.gs",
        declaration: "cpu_execute_hardware_interrupt_cycles",
        mirror: "GoboscriptCpuCore.execute_hardware_interrupt_cycles",
    },
    {
        source: "src/cpu_sequence.gs",
        declaration: "cpu_apply_relative_branch_cycles",
        mirror: "GoboscriptCpuCore.apply_relative_branch_cycles",
    },
    { source: "src/cartridge.gs", declaration: "header_byte", mirror: "GoboscriptCartridgeParser.header_byte" },
    { source: "src/cartridge.gs", declaration: "power_of_two", mirror: "power_of_two" },
    { source: "src/cartridge.gs", declaration: "is_safe_size", mirror: "is_safe_size" },
    {
        source: "src/cartridge.gs",
        declaration: "decode_nes2_rom_size",
        mirror: "decode_nes2_rom_size",
    },
    {
        source: "src/cartridge.gs",
        declaration: "decode_nes2_ram_size",
        mirror: "decode_nes2_ram_size",
    },
    {
        source: "src/cartridge.gs",
        declaration: "cartridge_has_magic",
        mirror: "GoboscriptCartridgeParser.cartridge_has_magic",
    },
    {
        source: "src/cartridge.gs",
        declaration: "cartridge_reset_results",
        mirror: "GoboscriptCartridgeParser.reset",
    },
    { source: "src/cartridge.gs", declaration: "cartridge_fail", mirror: "GoboscriptCartridgeParser.fail" },
    {
        source: "src/cartridge.gs",
        declaration: "cartridge_parse_header",
        mirror: "GoboscriptCartridgeParser.parse",
    },
    {
        source: "src/rom_loader.gs",
        declaration: "cartridge_load_header",
        mirror: null,
        reason: "copies the generated ROM list into the parser input; ROM data is covered by scratch-rom-assets",
    },
    {
        source: "src/rom_loader.gs",
        declaration: "rom_header_report",
        mirror: null,
        reason: "formats the self-test summary text",
    },
    {
        source: "src/rom_loader.gs",
        declaration: "test_rom_has_ines_header",
        mirror: null,
        reason: "checks the generated ROM data list, which tests/scratch-rom-assets.test.ts covers",
    },
    {
        source: "src/vector_selftest.gs",
        declaration: "run_port_self_test",
        mirror: null,
        reason: "self-test driver; the fixture replay tests cover the algorithms it dispatches to",
    },
    {
        source: "src/vector_selftest.gs",
        declaration: "run_next_port_vector",
        mirror: null,
        reason: "record walker; its enum ids are checked against the fixture below",
    },
    { source: "src/vector_selftest.gs", declaration: "run_numeric_vector", mirror: null, reason: "dispatcher" },
    { source: "src/vector_selftest.gs", declaration: "run_alu_vector", mirror: null, reason: "dispatcher" },
    { source: "src/vector_selftest.gs", declaration: "run_bus_vector", mirror: null, reason: "dispatcher" },
    {
        source: "src/vector_selftest.gs",
        declaration: "port_detach_bus_devices",
        mirror: "GoboscriptCpuBus.detach_devices",
    },
    { source: "src/vector_selftest.gs", declaration: "run_controller_vector", mirror: null, reason: "dispatcher" },
    { source: "src/vector_selftest.gs", declaration: "run_cartridge_vector", mirror: null, reason: "dispatcher" },
    {
        source: "src/vector_selftest.gs",
        declaration: "run_cpu_addressing_vector",
        mirror: null,
        reason: "dispatcher",
    },
    {
        source: "src/vector_selftest.gs",
        declaration: "run_cpu_sequence_vector",
        mirror: null,
        reason: "dispatcher",
    },
    {
        source: "src/vector_selftest.gs",
        declaration: "run_cpu_instruction_vector",
        mirror: null,
        reason: "dispatcher",
    },
    {
        source: "src/vector_selftest.gs",
        declaration: "run_cpu_opcode_vector",
        mirror: null,
        reason: "dispatcher",
    },
    {
        source: "src/vector_selftest.gs",
        declaration: "run_cpu_control_vector",
        mirror: null,
        reason: "dispatcher",
    },
    { source: "src/vector_selftest.gs", declaration: "run_nrom_vector", mirror: null, reason: "dispatcher" },
    {
        source: "src/rom_run.gs",
        declaration: "rom_run_start",
        mirror: null,
        reason: "console boot; it composes the mirrored bus, board, and CPU helpers the way NesConsole.reset does",
    },
    {
        source: "src/rom_run.gs",
        declaration: "rom_run_loop",
        mirror: null,
        reason: "frame driver; it schedules the mirrored frame loop instead of computing anything",
    },
    {
        source: "src/rom_run.gs",
        declaration: "rom_run_update_status",
        mirror: null,
        reason: "report formatting only",
    },
    {
        source: "src/cartridge_loader.gs",
        declaration: "cartridge_load_board",
        mirror: null,
        reason: "composes the parser, mapper selection, and the two board attachments",
    },
    {
        source: "src/cartridge_loader.gs",
        declaration: "cartridge_attach_nrom",
        mirror: null,
        reason: "composes the board validation, payload copy, and bus attachment",
    },
    {
        source: "src/cartridge_loader.gs",
        declaration: "cartridge_attach_mmc3",
        mirror: null,
        reason: "composes the board validation, payload copy, and bus attachment",
    },
    {
        source: "src/cartridge_loader.gs",
        declaration: "cartridge_board_irq_line",
        mirror: "GoboscriptCpuBus.board_irq_line",
    },
    { source: "src/mapper_000.gs", declaration: "nrom_reset_memory", mirror: "GoboscriptNromMapper.reset_memory" },
    { source: "src/mapper_000.gs", declaration: "nrom_copy_prg_rom", mirror: "GoboscriptNromMapper.copy_prg_rom" },
    { source: "src/mapper_000.gs", declaration: "nrom_copy_chr_rom", mirror: "GoboscriptNromMapper.copy_chr_rom" },
    { source: "src/mapper_000.gs", declaration: "nrom_copy_trainer", mirror: "GoboscriptNromMapper.copy_trainer" },
    { source: "src/mapper_000.gs", declaration: "nrom_load_payload", mirror: "GoboscriptNromMapper.load_payload" },
    { source: "src/mapper_000.gs", declaration: "nrom_read_cpu", mirror: "GoboscriptNromMapper.read_cpu" },
    { source: "src/mapper_000.gs", declaration: "nrom_write_cpu", mirror: "GoboscriptNromMapper.write_cpu" },
    { source: "src/mapper_000.gs", declaration: "nrom_read_pattern", mirror: "GoboscriptNromMapper.read_pattern" },
    {
        source: "src/mapper_000.gs",
        declaration: "nrom_write_pattern",
        mirror: "GoboscriptNromMapper.write_pattern",
    },
    { source: "src/mapper_000.gs", declaration: "nrom_get_prg_nvram_snapshot", mirror: "GoboscriptNromMapper.get_prg_nvram_snapshot" },
    { source: "src/mapper_000.gs", declaration: "nrom_load_prg_nvram_snapshot", mirror: "GoboscriptNromMapper.load_prg_nvram_snapshot" },
    { source: "src/mapper_000.gs", declaration: "nrom_get_chr_nvram_snapshot", mirror: "GoboscriptNromMapper.get_chr_nvram_snapshot" },
    { source: "src/mapper_000.gs", declaration: "nrom_load_chr_nvram_snapshot", mirror: "GoboscriptNromMapper.load_chr_nvram_snapshot" },
    {
        source: "src/vector_selftest.gs",
        declaration: "run_nrom_memory_vector",
        mirror: null,
        reason: "dispatcher",
    },
    {
        source: "src/vector_selftest.gs",
        declaration: "run_cartridge_bus_vector",
        mirror: null,
        reason: "dispatcher",
    },
    { source: "src/vector_selftest.gs", declaration: "run_mmc3_vector", mirror: null, reason: "dispatcher" },
    { source: "src/mapper_004.gs", declaration: "mmc3_reset", mirror: "GoboscriptMmc3Mapper.reset" },
    { source: "src/mapper_004.gs", declaration: "mmc3_validate", mirror: "GoboscriptMmc3Mapper.validate" },
    { source: "src/mapper_004.gs", declaration: "mmc3_reset_memory", mirror: "GoboscriptMmc3Mapper.reset_memory" },
    { source: "src/mapper_004.gs", declaration: "mmc3_copy_prg_rom", mirror: "GoboscriptMmc3Mapper.copy_prg_rom" },
    { source: "src/mapper_004.gs", declaration: "mmc3_copy_chr_rom", mirror: "GoboscriptMmc3Mapper.copy_chr_rom" },
    { source: "src/mapper_004.gs", declaration: "mmc3_copy_trainer", mirror: "GoboscriptMmc3Mapper.copy_trainer" },
    { source: "src/mapper_004.gs", declaration: "mmc3_load_payload", mirror: "GoboscriptMmc3Mapper.load_payload" },
    { source: "src/mapper_004.gs", declaration: "mmc3_prg_bank", mirror: "GoboscriptMmc3Mapper.prg_bank" },
    { source: "src/mapper_004.gs", declaration: "mmc3_chr_bank", mirror: "GoboscriptMmc3Mapper.chr_bank" },
    {
        source: "src/mapper_004.gs",
        declaration: "mmc3_refresh_chr_cache",
        mirror: null,
        reason: "CHR bank cache for PPU performance, not part of reference",
    },
    { source: "src/mapper_004.gs", declaration: "mmc3_write_register", mirror: "GoboscriptMmc3Mapper.write_register" },
    { source: "src/mapper_004.gs", declaration: "mmc3_read_cpu", mirror: "GoboscriptMmc3Mapper.read_cpu" },
    { source: "src/mapper_004.gs", declaration: "mmc3_write_cpu", mirror: "GoboscriptMmc3Mapper.write_cpu" },
    { source: "src/mapper_004.gs", declaration: "mmc3_read_pattern", mirror: "GoboscriptMmc3Mapper.read_pattern" },
    {
        source: "src/mapper_004.gs",
        declaration: "mmc3_write_pattern",
        mirror: "GoboscriptMmc3Mapper.write_pattern",
    },
    {
        source: "src/mapper_004.gs",
        declaration: "mmc3_get_prg_nvram_snapshot",
        mirror: "GoboscriptMmc3Mapper.get_prg_nvram_snapshot",
    },
    {
        source: "src/mapper_004.gs",
        declaration: "mmc3_load_prg_nvram_snapshot",
        mirror: "GoboscriptMmc3Mapper.load_prg_nvram_snapshot",
    },
    {
        source: "src/mapper_004.gs",
        declaration: "mmc3_get_chr_nvram_snapshot",
        mirror: "GoboscriptMmc3Mapper.get_chr_nvram_snapshot",
    },
    {
        source: "src/mapper_004.gs",
        declaration: "mmc3_load_chr_nvram_snapshot",
        mirror: "GoboscriptMmc3Mapper.load_chr_nvram_snapshot",
    },
    {
        source: "src/mapper_004.gs",
        declaration: "mmc3_observe_ppu_access",
        mirror: "GoboscriptMmc3Mapper.observe_ppu_access",
    },
    {
        source: "src/mapper_004.gs",
        declaration: "mmc3_observe_ppu_address",
        mirror: "GoboscriptMmc3Mapper.observe_ppu_address",
    },
    {
        source: "src/mapper_004.gs",
        declaration: "mmc3_clock_ppu_dot",
        mirror: "GoboscriptMmc3Mapper.clock_ppu_dot",
    },
    {
        source: "src/mapper_004.gs",
        declaration: "mmc3_get_irq_line_asserted",
        mirror: "GoboscriptMmc3Mapper.get_irq_line_asserted",
    },
    {
        source: "src/mapper_004.gs",
        declaration: "mmc3_observe_ppu_a12",
        mirror: "GoboscriptMmc3Mapper.observe_ppu_a12",
    },
    {
        source: "src/mapper_004.gs",
        declaration: "mmc3_clock_irq_counter",
        mirror: "GoboscriptMmc3Mapper.clock_irq_counter",
    },
    {
        source: "src/cpu_control.gs",
        declaration: "cpu_clear_interrupt_state",
        mirror: "GoboscriptCpuCore.clear_interrupt_state",
    },
    { source: "src/cpu_control.gs", declaration: "cpu_request_nmi", mirror: "GoboscriptCpuCore.request_nmi" },
    { source: "src/cpu_control.gs", declaration: "cpu_set_irq_line", mirror: "GoboscriptCpuCore.set_irq_line" },
    {
        source: "src/cpu_control.gs",
        declaration: "cpu_execute_jammed_cycles",
        mirror: "GoboscriptCpuCore.execute_jammed_cycles",
    },
    {
        source: "src/cpu_control.gs",
        declaration: "cpu_finish_instruction",
        mirror: "GoboscriptCpuCore.finish_instruction",
    },
    {
        source: "src/cpu_control.gs",
        declaration: "cpu_begin_next_sequence",
        mirror: "GoboscriptCpuCore.begin_next_sequence",
    },
    { source: "src/frame_loop.gs", declaration: "frame_loop_reset", mirror: null, reason: "frame loop pending mirror" },
    { source: "src/frame_loop.gs", declaration: "frame_loop_run_chunk", mirror: null, reason: "frame loop pending mirror" },
    { source: "src/frame_loop.gs", declaration: "frame_loop_check_dma", mirror: null, reason: "frame loop pending mirror" },
    { source: "src/frame_loop.gs", declaration: "frame_loop_get_cycles_run", mirror: null, reason: "frame loop pending mirror" },
    { source: "src/frame_loop.gs", declaration: "frame_loop_is_frame_complete", mirror: null, reason: "frame loop pending mirror" },
    { source: "src/mapper.gs", declaration: "mapper_sum_memory_sizes", mirror: "mapper_sum_memory_sizes" },
    { source: "src/mapper.gs", declaration: "mapper_resolve", mirror: "GoboscriptMapperSelection.resolve" },
    { source: "src/mapper_000.gs", declaration: "nrom_reset_results", mirror: "GoboscriptNromMapper.reset_results" },
    { source: "src/mapper_000.gs", declaration: "nrom_validate", mirror: "GoboscriptNromMapper.validate" },
    { source: "src/mapper_000.gs", declaration: "nrom_check_prg_rom", mirror: "GoboscriptNromMapper.check_prg_rom" },
    { source: "src/mapper_000.gs", declaration: "nrom_accept_prg_rom", mirror: "GoboscriptNromMapper.accept_prg_rom" },
    {
        source: "src/mapper_000.gs",
        declaration: "nrom_apply_memory_limits",
        mirror: "GoboscriptNromMapper.apply_memory_limits",
    },
    { source: "src/vector_selftest.gs", declaration: "compare_vector_results", mirror: null, reason: "reporter" },
    { source: "src/vector_selftest.gs", declaration: "run_ppu_vector", mirror: null, reason: "dispatcher" },
    { source: "src/vector_selftest.gs", declaration: "run_apu_vector", mirror: null, reason: "dispatcher" },
    { source: "src/apu_2a03.gs", declaration: "apu_reset", mirror: null, reason: "not ported; stubbed no-audio port retained for bus compatibility, see backup branch" },
    { source: "src/apu_2a03.gs", declaration: "apu_write_register", mirror: null, reason: "not ported; stubbed no-audio port retained for bus compatibility, see backup branch" },
    { source: "src/apu_2a03.gs", declaration: "apu_write_pulse", mirror: null, reason: "not ported; stubbed no-audio port retained for bus compatibility, see backup branch" },
    { source: "src/apu_2a03.gs", declaration: "apu_write_pulse_sweep", mirror: null, reason: "not ported; stubbed no-audio port retained for bus compatibility, see backup branch" },
    { source: "src/apu_2a03.gs", declaration: "apu_write_triangle_control", mirror: null, reason: "not ported; stubbed no-audio port retained for bus compatibility, see backup branch" },
    { source: "src/apu_2a03.gs", declaration: "apu_write_triangle_timer_low", mirror: null, reason: "not ported; stubbed no-audio port retained for bus compatibility, see backup branch" },
    { source: "src/apu_2a03.gs", declaration: "apu_write_triangle_timer_high", mirror: null, reason: "not ported; stubbed no-audio port retained for bus compatibility, see backup branch" },
    { source: "src/apu_2a03.gs", declaration: "apu_write_noise_control", mirror: null, reason: "not ported; stubbed no-audio port retained for bus compatibility, see backup branch" },
    { source: "src/apu_2a03.gs", declaration: "apu_write_noise_period", mirror: null, reason: "not ported; stubbed no-audio port retained for bus compatibility, see backup branch" },
    { source: "src/apu_2a03.gs", declaration: "apu_write_noise_length", mirror: null, reason: "not ported; stubbed no-audio port retained for bus compatibility, see backup branch" },
    { source: "src/apu_2a03.gs", declaration: "apu_write_dmc_control", mirror: null, reason: "not ported; stubbed no-audio port retained for bus compatibility, see backup branch" },
    { source: "src/apu_2a03.gs", declaration: "apu_write_dmc_output_level", mirror: null, reason: "not ported; stubbed no-audio port retained for bus compatibility, see backup branch" },
    { source: "src/apu_2a03.gs", declaration: "apu_write_dmc_sample_address", mirror: null, reason: "not ported; stubbed no-audio port retained for bus compatibility, see backup branch" },
    { source: "src/apu_2a03.gs", declaration: "apu_write_dmc_sample_length", mirror: null, reason: "not ported; stubbed no-audio port retained for bus compatibility, see backup branch" },
    { source: "src/apu_2a03.gs", declaration: "apu_write_status", mirror: null, reason: "not ported; stubbed no-audio port retained for bus compatibility, see backup branch" },
    { source: "src/apu_2a03.gs", declaration: "apu_write_frame_counter", mirror: null, reason: "not ported; stubbed no-audio port retained for bus compatibility, see backup branch" },
    { source: "src/apu_2a03.gs", declaration: "apu_read_status", mirror: null, reason: "not ported; stubbed no-audio port retained for bus compatibility, see backup branch" },
    { source: "src/apu_2a03.gs", declaration: "apu_clock_cpu_cycle", mirror: null, reason: "not ported; stubbed no-audio port retained for bus compatibility, see backup branch" },
    { source: "src/apu_2a03.gs", declaration: "apu_clock_pulse_timer", mirror: null, reason: "not ported; stubbed no-audio port retained for bus compatibility, see backup branch" },
    { source: "src/apu_2a03.gs", declaration: "apu_clock_frame_sequencer", mirror: null, reason: "not ported; stubbed no-audio port retained for bus compatibility, see backup branch" },
    { source: "src/apu_2a03.gs", declaration: "apu_clock_quarter_frame", mirror: null, reason: "not ported; stubbed no-audio port retained for bus compatibility, see backup branch" },
    { source: "src/apu_2a03.gs", declaration: "apu_clock_half_frame", mirror: null, reason: "not ported; stubbed no-audio port retained for bus compatibility, see backup branch" },
    { source: "src/apu_2a03.gs", declaration: "apu_clock_pulse_envelope", mirror: null, reason: "not ported; stubbed no-audio port retained for bus compatibility, see backup branch" },
    { source: "src/apu_2a03.gs", declaration: "apu_clock_pulse_half_frame", mirror: null, reason: "not ported; stubbed no-audio port retained for bus compatibility, see backup branch" },
    { source: "src/apu_2a03.gs", declaration: "apu_clock_pulse_sweep", mirror: null, reason: "not ported; stubbed no-audio port retained for bus compatibility, see backup branch" },
    { source: "src/apu_2a03.gs", declaration: "apu_clock_triangle_timer", mirror: null, reason: "not ported; stubbed no-audio port retained for bus compatibility, see backup branch" },
    { source: "src/apu_2a03.gs", declaration: "apu_clock_triangle_linear_counter", mirror: null, reason: "not ported; stubbed no-audio port retained for bus compatibility, see backup branch" },
    { source: "src/apu_2a03.gs", declaration: "apu_clock_triangle_half_frame", mirror: null, reason: "not ported; stubbed no-audio port retained for bus compatibility, see backup branch" },
    { source: "src/apu_2a03.gs", declaration: "apu_clock_noise_timer", mirror: null, reason: "not ported; stubbed no-audio port retained for bus compatibility, see backup branch" },
    { source: "src/apu_2a03.gs", declaration: "apu_shift_lfsr", mirror: null, reason: "not ported; stubbed no-audio port retained for bus compatibility, see backup branch" },
    { source: "src/apu_2a03.gs", declaration: "apu_clock_noise_envelope", mirror: null, reason: "not ported; stubbed no-audio port retained for bus compatibility, see backup branch" },
    { source: "src/apu_2a03.gs", declaration: "apu_clock_noise_length", mirror: null, reason: "not ported; stubbed no-audio port retained for bus compatibility, see backup branch" },
    { source: "src/apu_2a03.gs", declaration: "apu_clock_dmc_timer", mirror: null, reason: "not ported; stubbed no-audio port retained for bus compatibility, see backup branch" },
    { source: "src/apu_2a03.gs", declaration: "apu_clock_dmc_output_unit", mirror: null, reason: "not ported; stubbed no-audio port retained for bus compatibility, see backup branch" },
    { source: "src/apu_2a03.gs", declaration: "apu_dmc_restart_sample", mirror: null, reason: "not ported; stubbed no-audio port retained for bus compatibility, see backup branch" },
    { source: "src/apu_2a03.gs", declaration: "apu_dmc_complete_dma_read", mirror: null, reason: "not ported; stubbed no-audio port retained for bus compatibility, see backup branch" },
    { source: "src/apu_2a03.gs", declaration: "apu_get_pulse_output", mirror: null, reason: "not ported; stubbed no-audio port retained for bus compatibility, see backup branch" },
    { source: "src/apu_2a03.gs", declaration: "apu_pulse_output", mirror: null, reason: "not ported; stubbed no-audio port retained for bus compatibility, see backup branch" },
    { source: "src/apu_2a03.gs", declaration: "apu_get_pulse_length", mirror: null, reason: "not ported; stubbed no-audio port retained for bus compatibility, see backup branch" },
    { source: "src/apu_2a03.gs", declaration: "apu_get_triangle_output", mirror: null, reason: "not ported; stubbed no-audio port retained for bus compatibility, see backup branch" },
    { source: "src/apu_2a03.gs", declaration: "apu_get_triangle_length", mirror: null, reason: "not ported; stubbed no-audio port retained for bus compatibility, see backup branch" },
    { source: "src/apu_2a03.gs", declaration: "apu_get_noise_output", mirror: null, reason: "not ported; stubbed no-audio port retained for bus compatibility, see backup branch" },
    { source: "src/apu_2a03.gs", declaration: "apu_get_noise_length", mirror: null, reason: "not ported; stubbed no-audio port retained for bus compatibility, see backup branch" },
    { source: "src/apu_2a03.gs", declaration: "apu_get_dmc_output", mirror: null, reason: "not ported; stubbed no-audio port retained for bus compatibility, see backup branch" },
    { source: "src/apu_2a03.gs", declaration: "apu_get_dmc_bytes_remaining", mirror: null, reason: "not ported; stubbed no-audio port retained for bus compatibility, see backup branch" },
    { source: "src/apu_2a03.gs", declaration: "apu_dmc_get_dma_request_address", mirror: null, reason: "not ported; stubbed no-audio port retained for bus compatibility, see backup branch" },
    { source: "src/apu_2a03.gs", declaration: "apu_is_dmc_irq_asserted", mirror: null, reason: "not ported; stubbed no-audio port retained for bus compatibility, see backup branch" },
    { source: "src/apu_2a03.gs", declaration: "apu_mix_channels", mirror: null, reason: "not ported; stubbed no-audio port retained for bus compatibility, see backup branch" },
    { source: "src/apu_2a03.gs", declaration: "apu_is_frame_irq_asserted", mirror: null, reason: "not ported; stubbed no-audio port retained for bus compatibility, see backup branch" },
    { source: "src/apu_2a03.gs", declaration: "apu_is_irq_asserted", mirror: null, reason: "not ported; stubbed no-audio port retained for bus compatibility, see backup branch" },
    { source: "src/apu_2a03.gs", declaration: "apu_pulse_sweep_target", mirror: null, reason: "not ported; stubbed no-audio port retained for bus compatibility, see backup branch" },
    { source: "src/apu_2a03.gs", declaration: "apu_pulse_sweep_in_range", mirror: null, reason: "not ported; stubbed no-audio port retained for bus compatibility, see backup branch" },
    { source: "src/apu_2a03.gs", declaration: "apu_sweep_target_would_oor", mirror: null, reason: "not ported; stubbed no-audio port retained for bus compatibility, see backup branch" },
    { source: "src/apu_2a03.gs", declaration: "apu_power_of_two", mirror: null, reason: "not ported; stubbed no-audio port retained for bus compatibility, see backup branch" },
    { source: "src/cartridge_loader.gs", declaration: "cartridge_get_prg_nvram_snapshot", mirror: null, reason: "save/load wiring" },
    { source: "src/cartridge_loader.gs", declaration: "cartridge_load_prg_nvram_snapshot", mirror: null, reason: "save/load wiring" },
    { source: "src/cartridge_loader.gs", declaration: "cartridge_get_chr_nvram_snapshot", mirror: null, reason: "save/load wiring" },
    { source: "src/cartridge_loader.gs", declaration: "cartridge_load_chr_nvram_snapshot", mirror: null, reason: "save/load wiring" },
    { source: "src/ppu_bus.gs", declaration: "ppu_bus_reset", mirror: null, reason: "ppu bus pending mirror" },
    { source: "src/ppu_bus.gs", declaration: "ppu_bus_clear_memory", mirror: null, reason: "ppu bus pending mirror" },
    { source: "src/ppu_bus.gs", declaration: "ppu_bus_attach_mapper", mirror: null, reason: "ppu bus pending mirror" },
    { source: "src/ppu_bus.gs", declaration: "ppu_bus_get_mirroring", mirror: null, reason: "ppu bus pending mirror" },
    { source: "src/ppu_bus.gs", declaration: "ppu_bus_normalize_address", mirror: null, reason: "ppu bus pending mirror" },
    { source: "src/ppu_bus.gs", declaration: "ppu_bus_map_nametable", mirror: null, reason: "ppu bus pending mirror" },
    { source: "src/ppu_bus.gs", declaration: "ppu_bus_map_palette", mirror: null, reason: "ppu bus pending mirror" },
    { source: "src/ppu_bus.gs", declaration: "ppu_bus_read_ppu", mirror: null, reason: "ppu bus pending mirror" },
    {
        source: "src/ppu_bus.gs",
        declaration: "ppu_bus_read_nametable",
        mirror: null,
        reason: "rendering fast path; it reads the same bytes as ppu_bus_read_ppu without the address decode",
    },
    {
        source: "src/ppu_bus.gs",
        declaration: "ppu_bus_read_pattern_window",
        mirror: null,
        reason: "rendering fast path; it observes and reads pattern memory the way ppu_bus_read_ppu does",
    },
    { source: "src/ppu_bus.gs", declaration: "ppu_bus_write_ppu", mirror: null, reason: "ppu bus pending mirror" },
    { source: "src/ppu_bus.gs", declaration: "ppu_bus_read_pattern", mirror: null, reason: "ppu bus pending mirror" },
    { source: "src/ppu_bus.gs", declaration: "ppu_bus_write_pattern", mirror: null, reason: "ppu bus pending mirror" },
    { source: "src/ppu_bus.gs", declaration: "ppu_bus_observe_ppu_address", mirror: null, reason: "ppu bus pending mirror" },
    { source: "src/ppu_bus.gs", declaration: "ppu_bus_clock_ppu_dot", mirror: null, reason: "ppu bus pending mirror" },
    { source: "src/ppu_bus.gs", declaration: "ppu_bus_read_oam", mirror: null, reason: "ppu bus pending mirror" },
    { source: "src/ppu_bus.gs", declaration: "ppu_bus_write_oam", mirror: null, reason: "ppu bus pending mirror" },
    { source: "src/ppu_2c02.gs", declaration: "ppu_reset", mirror: null, reason: "ppu pending mirror" },
    { source: "src/ppu_2c02.gs", declaration: "ppu_set_status_flag", mirror: null, reason: "ppu pending mirror" },
    { source: "src/ppu_2c02.gs", declaration: "ppu_get_nmi_output", mirror: null, reason: "ppu pending mirror" },
    { source: "src/ppu_2c02.gs", declaration: "ppu_take_nmi_edge", mirror: null, reason: "ppu pending mirror" },
    { source: "src/ppu_2c02.gs", declaration: "ppu_set_vblank_flag", mirror: null, reason: "ppu pending mirror" },
    { source: "src/ppu_2c02.gs", declaration: "ppu_set_sprite_zero_hit", mirror: null, reason: "ppu pending mirror" },
    { source: "src/ppu_2c02.gs", declaration: "ppu_set_sprite_overflow", mirror: null, reason: "ppu pending mirror" },
    { source: "src/ppu_2c02.gs", declaration: "ppu_refresh_nmi_output", mirror: null, reason: "ppu pending mirror" },
    { source: "src/ppu_2c02.gs", declaration: "ppu_read_cpu_register", mirror: null, reason: "ppu pending mirror" },
    { source: "src/ppu_2c02.gs", declaration: "ppu_read_status_register", mirror: null, reason: "ppu pending mirror" },
    { source: "src/ppu_2c02.gs", declaration: "ppu_read_data_register", mirror: null, reason: "ppu pending mirror" },
    { source: "src/ppu_2c02.gs", declaration: "ppu_read_oam_data_register", mirror: null, reason: "ppu pending mirror" },
    { source: "src/ppu_2c02.gs", declaration: "ppu_write_cpu_register", mirror: null, reason: "ppu pending mirror" },
    {
        source: "src/ppu_2c02.gs",
        declaration: "ppu_decode_mask_register",
        mirror: null,
        reason: "writes the precomputed PPUMASK fields the renderer and dot loop read per pixel",
    },
    { source: "src/ppu_2c02.gs", declaration: "ppu_write_control_register", mirror: null, reason: "ppu pending mirror" },
    { source: "src/ppu_2c02.gs", declaration: "ppu_write_scroll_register", mirror: null, reason: "ppu pending mirror" },
    { source: "src/ppu_2c02.gs", declaration: "ppu_write_address_register", mirror: null, reason: "ppu pending mirror" },
    { source: "src/ppu_2c02.gs", declaration: "ppu_write_data_register", mirror: null, reason: "ppu pending mirror" },
    { source: "src/ppu_2c02.gs", declaration: "ppu_write_oam_data_register", mirror: null, reason: "ppu pending mirror" },
    { source: "src/ppu_2c02.gs", declaration: "ppu_increment_vram_address", mirror: null, reason: "ppu pending mirror" },
    { source: "src/ppu_2c02.gs", declaration: "ppu_clock_ppu_dot", mirror: null, reason: "ppu pending mirror" },
    { source: "src/ppu_2c02.gs", declaration: "ppu_clock_cpu_cycle", mirror: null, reason: "ppu pending mirror" },
    { source: "src/ppu_2c02.gs", declaration: "ppu_advance_dot", mirror: null, reason: "ppu pending mirror" },
    { source: "src/ppu_2c02.gs", declaration: "ppu_is_rendering_enabled", mirror: null, reason: "ppu pending mirror" },
    { source: "src/ppu_2c02.gs", declaration: "ppu_is_visible_or_pre_render_scanline", mirror: null, reason: "ppu pending mirror" },
    { source: "src/ppu_2c02.gs", declaration: "ppu_is_oam_cpu_access_during_rendering", mirror: null, reason: "ppu pending mirror" },
    { source: "src/ppu_2c02.gs", declaration: "ppu_get_scanline", mirror: null, reason: "ppu pending mirror" },
    { source: "src/ppu_2c02.gs", declaration: "ppu_get_dot", mirror: null, reason: "ppu pending mirror" },
    { source: "src/ppu_2c02.gs", declaration: "ppu_get_frame_number", mirror: null, reason: "ppu pending mirror" },
    { source: "src/ppu_2c02.gs", declaration: "ppu_is_odd_frame", mirror: null, reason: "ppu pending mirror" },
    { source: "src/ppu_2c02.gs", declaration: "ppu_get_control_register", mirror: null, reason: "ppu pending mirror" },
    { source: "src/ppu_2c02.gs", declaration: "ppu_get_mask_register", mirror: null, reason: "ppu pending mirror" },
    { source: "src/ppu_2c02.gs", declaration: "ppu_get_status_register", mirror: null, reason: "ppu pending mirror" },
    { source: "src/ppu_2c02.gs", declaration: "ppu_get_vram_address", mirror: null, reason: "ppu pending mirror" },
    { source: "src/ppu_2c02.gs", declaration: "ppu_get_temporary_vram_address", mirror: null, reason: "ppu pending mirror" },
    { source: "src/ppu_2c02.gs", declaration: "ppu_get_fine_x_scroll", mirror: null, reason: "ppu pending mirror" },
    { source: "src/ppu_2c02.gs", declaration: "ppu_get_oam_address", mirror: null, reason: "ppu pending mirror" },
    { source: "src/ppu_2c02.gs", declaration: "ppu_get_read_buffer", mirror: null, reason: "ppu pending mirror" },
    { source: "src/ppu_bus.gs", declaration: "ppu_bus_observe_access", mirror: null, reason: "ppu bus pending mirror" },
    { source: "src/ppu_2c02.gs", declaration: "ppu_reset_sprite_units", mirror: null, reason: "ppu rendering pending mirror" },
    { source: "src/ppu_2c02.gs", declaration: "ppu_clear_frame_output", mirror: null, reason: "ppu rendering pending mirror" },
    { source: "src/ppu_2c02.gs", declaration: "ppu_shift_pixel", mirror: "ppu_shift_pixel" },
    { source: "src/ppu_2c02.gs", declaration: "ppu_select_palette_offset", mirror: "ppu_select_palette_offset" },
    { source: "src/ppu_2c02.gs", declaration: "ppu_reverse_byte_bits", mirror: "ppu_reverse_byte_bits" },
    { source: "src/ppu_2c02.gs", declaration: "ppu_sprite_row", mirror: "ppu_sprite_row" },
    { source: "src/ppu_2c02.gs", declaration: "ppu_sprite_pattern_address", mirror: "ppu_sprite_pattern_address" },
    { source: "src/ppu_2c02.gs", declaration: "ppu_increment_scroll_x_for", mirror: "ppu_increment_scroll_x_for" },
    { source: "src/ppu_2c02.gs", declaration: "ppu_increment_scroll_y_for", mirror: "ppu_increment_scroll_y_for" },
    { source: "src/ppu_2c02.gs", declaration: "ppu_transfer_horizontal_for", mirror: "ppu_transfer_horizontal_for" },
    { source: "src/ppu_2c02.gs", declaration: "ppu_transfer_vertical_for", mirror: "ppu_transfer_vertical_for" },
    { source: "src/ppu_2c02.gs", declaration: "ppu_render_pixel", mirror: null, reason: "ppu rendering pending mirror" },
    { source: "src/ppu_2c02.gs", declaration: "ppu_read_sprite_pixel", mirror: null, reason: "ppu rendering pending mirror" },
    {
        source: "src/ppu_2c02.gs",
        declaration: "ppu_clock_sprite_output_units",
        mirror: null,
        reason: "ppu rendering pending mirror",
    },
    {
        source: "src/ppu_2c02.gs",
        declaration: "ppu_clock_rendering_pipeline",
        mirror: null,
        reason: "ppu rendering pending mirror",
    },
    {
        source: "src/ppu_2c02.gs",
        declaration: "ppu_shift_background_registers",
        mirror: null,
        reason: "ppu rendering pending mirror",
    },
    {
        source: "src/ppu_2c02.gs",
        declaration: "ppu_load_background_registers",
        mirror: null,
        reason: "ppu rendering pending mirror",
    },
    {
        source: "src/ppu_2c02.gs",
        declaration: "ppu_fetch_background_attribute",
        mirror: null,
        reason: "ppu rendering pending mirror",
    },
    {
        source: "src/ppu_2c02.gs",
        declaration: "ppu_fetch_background_pattern_low",
        mirror: null,
        reason: "ppu rendering pending mirror",
    },
    {
        source: "src/ppu_2c02.gs",
        declaration: "ppu_fetch_background_pattern_high",
        mirror: null,
        reason: "ppu rendering pending mirror",
    },
    {
        source: "src/ppu_2c02.gs",
        declaration: "ppu_evaluate_sprites_for_next_scanline",
        mirror: null,
        reason: "ppu rendering pending mirror",
    },
    { source: "src/ppu_2c02.gs", declaration: "ppu_clock_sprite_fetch", mirror: null, reason: "ppu rendering pending mirror" },
    {
        source: "src/nes_palette.gs",
        declaration: "nes_palette_init",
        mirror: null,
        reason: "fills the Stage palette lists from literals and builds the cache through nes_pen_color",
    },
    { source: "src/nes_palette.gs", declaration: "nes_palette_dim_channel", mirror: "nes_palette_dim_channel" },
    { source: "src/nes_palette.gs", declaration: "nes_palette_hex_byte", mirror: "nes_palette_hex_byte" },
    { source: "src/nes_palette.gs", declaration: "nes_pen_color", mirror: "nes_pen_color" },
    { source: "src/pen_display.gs", declaration: "pen_display_fit_scale", mirror: "pen_display_fit_scale" },
    { source: "src/pen_display.gs", declaration: "pen_display_scale_for", mirror: "pen_display_scale_for" },
    { source: "src/pen_display.gs", declaration: "pen_display_renderer_offset", mirror: "pen_display_renderer_offset" },
    { source: "src/pen_display.gs", declaration: "pen_display_first_x_for", mirror: "pen_display_first_x_for" },
    { source: "src/pen_display.gs", declaration: "pen_display_first_y_for", mirror: "pen_display_first_y_for" },
    {
        source: "src/pen_display.gs",
        declaration: "pen_display_update_geometry",
        mirror: null,
        reason: "writes the derived geometry variables from the mirrored pen_display funcs",
    },
    {
        source: "src/keyboard_input.gs",
        declaration: "keyboard_poll_controllers",
        mirror: null,
        reason:
            "host input sampling; it reads the Scratch key sensors and writes the masks the " +
            "mirrored controller ports report",
    },
    {
        source: "src/rom_input.gs",
        declaration: "rom_input_poll_key",
        mirror: null,
        reason: "host input sampling; it reads the Scratch key sensor and reports the press edge",
    },
    {
        source: "src/rom_input.gs",
        declaration: "rom_input_ask_for_text",
        mirror: null,
        reason: "host input; it issues the ask block and keeps the answer the runtime reports",
    },
    {
        source: "src/rom_input.gs",
        declaration: "rom_input_parse_text",
        mirror: "GoboscriptRomInput.parse_text",
    },
    {
        source: "src/rom_input.gs",
        declaration: "rom_input_has_signature",
        mirror: "GoboscriptRomInput.has_signature",
    },
    {
        source: "src/rom_input.gs",
        declaration: "rom_input_validate_image",
        mirror: "GoboscriptRomInput.validate_image",
    },
    {
        source: "src/rom_input.gs",
        declaration: "rom_input_install_image",
        mirror: "GoboscriptRomInput.install_image",
    },
    {
        source: "src/rom_input.gs",
        declaration: "rom_input_error_text",
        mirror: null,
        reason: "user-facing report text; the codes it words are mirrored as rom_input_error",
    },
    {
        source: "src/rom_run.gs",
        declaration: "rom_run_load_input_image",
        mirror: null,
        reason:
            "host input orchestration; it drives the ask block, the mirrored decode, and the " +
            "boot path the embedded image uses",
    },
    {
        source: "main.gs",
        declaration: "pen_draw_frame",
        mirror: null,
        reason: "sprite pen presentation; it issues pen and motion blocks over Stage lists",
    },
    {
        source: "main.gs",
        declaration: "pen_draw_run",
        mirror: null,
        reason: "sprite pen presentation; it issues pen and motion blocks over Stage lists",
    },
];

const sources = load_sources();

test("the GoboScript project contains the expected sources", () => {
    const paths = sources.map((source) => source.path).sort();
    assert.deepEqual(paths, [
        "main.gs",
        "src/apu_2a03.gs",
        "src/bitwise_tables.gs",
        "src/cartridge.gs",
        "src/cartridge_loader.gs",
        "src/controller.gs",
        "src/cpu_addressing.gs",
        "src/cpu_alu.gs",
        "src/cpu_bus.gs",
        "src/cpu_control.gs",
        "src/cpu_core.gs",
        "src/cpu_instruction.gs",
        "src/cpu_opcode.gs",
        "src/cpu_sequence.gs",
        "src/cpu_status.gs",
        "src/frame_loop.gs",
        "src/keyboard_input.gs",
        "src/mapper.gs",
        "src/mapper_000.gs",
        "src/mapper_004.gs",
        "src/nes_palette.gs",
        "src/numeric.gs",
        "src/pen_display.gs",
        "src/ppu_2c02.gs",
        "src/ppu_bus.gs",
        "src/rom_input.gs",
        "src/rom_loader.gs",
        "src/rom_run.gs",
        "src/shared_vectors.gs",
        "src/vector_selftest.gs",
        "stage.gs",
    ]);
});

test("every top-level line of a GoboScript source is a declaration", () => {
    // The upstream grammar is `Sprite = Declr*`, and a declaration is a proc, a func, a
    // variable, a list, an enum, a struct, an event hat, or an asset statement. A bare
    // statement at the top level, such as a `forever` loop, is a parse error the compiler
    // would reject, so it has to live inside an event hat or a proc body.
    const violations: string[] = [];

    for (const source of sources) {
        let depth = 0;

        for (const [index, raw_line] of source.lines.entries()) {
            const line = raw_line.trim();

            if (depth === 0) {
                if (line === "" || line.startsWith("#")) {
                    continue;
                }

                if (!TOP_LEVEL_DECLARATIONS.some((pattern) => pattern.test(line))) {
                    violations.push(`${source.path}:${index + 1}: ${line} is not a declaration`);
                }
            }

            depth += count_character(strip_comments_and_strings(raw_line), "{");
            depth -= count_character(strip_comments_and_strings(raw_line), "}");
        }

        assert.equal(depth, 0, `${source.path} has an unbalanced brace`);
    }

    assert.deepEqual(violations, []);
});

test("every GoboScript source is ASCII with no tabs, trailing whitespace, or CRLF", () => {
    for (const source of sources) {
        const bytes = readFileSync(join(SCRATCH_DIRECTORY, source.path));

        for (const [index, byte] of bytes.entries()) {
            assert.ok(byte < 128, `${source.path}: byte ${index} is not ASCII`);
        }

        assert.ok(!source.text.includes("\r"), `${source.path}: contains a carriage return`);
        assert.ok(!source.text.includes("\t"), `${source.path}: contains a tab`);

        for (const [index, line] of source.lines.entries()) {
            assert.equal(line, line.trimEnd(), `${source.path}:${index + 1}: trailing whitespace`);
        }
    }
});

test("every GoboScript source uses four-space indentation within the column limit", () => {
    for (const source of sources) {
        for (const [index, line] of source.lines.entries()) {
            const location = `${source.path}:${index + 1}`;
            assert.ok(line.length <= MAX_LINE_COLUMNS, `${location}: ${line.length} columns`);

            if (line.trim() === "") {
                assert.equal(line, "", `${location}: blank line contains whitespace`);
                continue;
            }

            const indent = line.length - line.trimStart().length;

            if (line.startsWith("%")) {
                assert.equal(indent, 0, `${location}: preprocessor directives start at column one`);
                continue;
            }

            // Continuation lines of a wrapped expression may add half an indent level.
            const is_continuation = /^(and|or|&)\b/.test(line.trimStart());
            const allowed = is_continuation
                ? indent % INDENT_WIDTH === 0 || indent % INDENT_WIDTH === INDENT_WIDTH / 2
                : indent % INDENT_WIDTH === 0;
            assert.ok(allowed, `${location}: indent of ${indent} is not a multiple of ${INDENT_WIDTH}`);
        }

        assert.ok(source.text.endsWith("\n"), `${source.path}: missing final newline`);
        assert.ok(!source.text.endsWith("\n\n"), `${source.path}: blank line at end of file`);
    }
});

test("every %include directive resolves to a project source", () => {
    for (const source of sources) {
        for (const [index, line] of source.lines.entries()) {
            if (!line.startsWith("%")) {
                assert.ok(!line.includes("%include"), `${source.path}:${index + 1}: directive is not at column one`);
                continue;
            }

            const match = /^%include (\S+)$/.exec(line);
            assert.ok(match, `${source.path}:${index + 1}: unsupported or malformed directive "${line}"`);

            const included = match?.[1];
            assert.ok(included !== undefined);
            assert.ok(
                !included.startsWith('"') && !included.endsWith(";"),
                `${source.path}:${index + 1}: include paths are unquoted and take no semicolon`,
            );
            assert.ok(
                sources.some((candidate) => candidate.path === `${included}.gs`),
                `${source.path}:${index + 1}: %include ${included} does not resolve`,
            );
        }
    }
});

test("only the Stage declares shared state", () => {
    // A sprite resolves Stage variable, list, and enum names, so including a state-declaring
    // header in a sprite would create sprite-local duplicates instead of shared state. Headers
    // may include each other freely: they are only ever compiled into the Stage here.
    for (const source of sources.filter((candidate) => is_sprite_root(candidate.path))) {
        for (const included of collect_includes(source)) {
            if (included === "stage.gs") {
                continue;
            }

            const header = get_source(included);
            const state = header.declarations.filter(
                (declaration) => declaration.kind === "var" || declaration.kind === "list",
            );
            assert.deepEqual(
                state.map((declaration) => `${included}:${declaration.name}`),
                [],
                `${source.path} includes ${included}, which declares shared state`,
            );
        }
    }
});

test("no proc returns and every func ends with a return", () => {
    for (const source of sources) {
        for (const declaration of source.declarations) {
            if (declaration.kind !== "proc" && declaration.kind !== "func") {
                continue;
            }

            const location = `${source.path}:${declaration.line}`;
            const statements = split_statements(declaration.body);

            if (declaration.kind === "proc") {
                // `return` inside a proc makes the upstream compiler panic in codegen.
                for (const statement of statements) {
                    assert.ok(!/^return\b/.test(statement), `${location}: proc ${declaration.name} returns`);
                }
                continue;
            }

            const last = statements.at(-1) ?? "";
            assert.match(last, /^return\b/, `${location}: func ${declaration.name} does not end with a return`);
        }
    }
});

test("no local is declared inside a loop body", () => {
    // `local` compiles to a `procname:x` variable; declaring one inside a loop body shadows
    // the previous iteration's value and is undefined behavior in recursive or non-warp procs.
    for (const source of sources) {
        for (const declaration of source.declarations) {
            const loop_ranges = find_loop_bodies(declaration.body);

            for (const [start, end] of loop_ranges) {
                for (const line of declaration.body.slice(start, end + 1)) {
                    assert.ok(
                        !/^\s*local\b/.test(line),
                        `${source.path}:${declaration.line}: ${declaration.name} declares a local inside a loop`,
                    );
                }
            }
        }
    }
});

test("no declared name collides with a GoboScript keyword or a Scratch block shape", () => {
    const reserved = new Set([...GOBOSCRIPT_KEYWORDS, ...SCRATCH_BLOCK_NAMES]);

    for (const source of sources) {
        for (const declaration of source.declarations) {
            assert.ok(
                !reserved.has(declaration.name),
                `${source.path}:${declaration.line}: "${declaration.name}" is a reserved block or keyword name`,
            );

            for (const arg of declaration.args) {
                assert.ok(!reserved.has(arg), `${source.path}:${declaration.line}: argument "${arg}" is reserved`);
            }
        }

        for (const enumeration of source.enums) {
            assert.ok(
                !reserved.has(enumeration.name),
                `${source.path}: enum "${enumeration.name}" is a reserved block or keyword name`,
            );

            for (const variant of enumeration.variants.keys()) {
                assert.ok(!reserved.has(variant), `${source.path}: enum variant "${variant}" is reserved`);
            }
        }
    }
});

test("procs are called without parentheses and funcs with parentheses at the declared arity", () => {
    // GoboScript calls a proc as `name arg1, arg2;` and a func as `name(arg1, arg2)`. A
    // parenthesized multi-argument proc call does not parse, and a func called with the comma
    // form is indistinguishable from a proc call, so without a compiler these shapes are worth
    // a lint.
    const callables = declared_callables();
    const violations: string[] = [];

    for (const source of sources) {
        const text = callable_scan_text(source);

        for (const call of parenthesized_call_sites(text)) {
            const callable = callables.get(call.name);

            if (callable === undefined) {
                continue;
            }

            const location = `${source.path}:${line_at(text, call.offset)}`;

            if (callable.kind === "proc") {
                violations.push(`${location}: proc ${call.name} must be called without parentheses`);
                continue;
            }

            if (call.args.length !== callable.arity) {
                violations.push(
                    `${location}: func ${call.name} expects ${callable.arity} argument(s), ` +
                        `called with ${call.args.length}`,
                );
            }
        }

        for (const call of statement_call_sites(text)) {
            const callable = callables.get(call.name);

            if (callable === undefined) {
                continue;
            }

            const location = `${source.path}:${line_at(text, call.offset)}`;

            if (callable.kind === "func") {
                violations.push(`${location}: func ${call.name} returns a value and cannot be a statement`);
                continue;
            }

            if (call.args.length !== callable.arity) {
                violations.push(
                    `${location}: proc ${call.name} expects ${callable.arity} argument(s), ` +
                        `called with ${call.args.length}`,
                );
            }
        }
    }

    assert.deepEqual(violations, []);
});

/**
 * Callables that spend cycles or change bus, register, or stack state. GoboScript hoists an
 * expression-position func call into a statement placed before the enclosing statement
 * (`src/visitor/pass1.rs` lowers it to a call plus a callsite variable), so nesting one of
 * these inside another call's arguments would run it earlier than the source reads and
 * silently reorder the access trace. Each must be the head of its own statement.
 */
const CYCLE_SPENDING_CALLABLES: readonly string[] = [
    "cpu_read_cycle",
    "cpu_write_cycle",
    "cpu_dummy_read_cycle",
    "cpu_fetch_byte",
    "cpu_fetch_word",
    "cpu_push_byte",
    "cpu_pop_byte",
    "cpu_push_word",
    "cpu_pop_word",
    "cpu_push_status",
    "cpu_restore_status_from_stack",
    "cpu_resolve_operand",
    "cpu_bus_read",
    "cpu_bus_write",
];

test("arguments are read through a dollar sign inside their own body", () => {
    // GoboScript resolves a bare name to a variable, list, enum, proc, or func; only `$name`
    // reads a procedure argument. A bare argument name therefore becomes an unrelated name
    // lookup instead of a compile error, and the name-resolution check above cannot tell the
    // two apart, so the shape needs its own lint. A local of the same name is a deliberate
    // shadow and is allowed.
    const violations: string[] = [];

    for (const source of sources) {
        for (const declaration of source.declarations) {
            if ((declaration.kind !== "proc" && declaration.kind !== "func") || declaration.args.length === 0) {
                continue;
            }

            const locals = new Set(
                declaration.body
                    .flatMap((line) => [...strip_comments_and_strings(line).matchAll(/\blocal\s+(\w+)\b/g)])
                    .map((match) => match[1] ?? ""),
            );

            declaration.body.forEach((raw_line, offset) => {
                const line = strip_comments_and_strings(raw_line);

                for (const arg of declaration.args) {
                    if (locals.has(arg)) {
                        continue;
                    }

                    if (new RegExp(`(^|[^\\w.$])${arg}([^\\w]|$)`).test(line)) {
                        violations.push(
                            `${source.path}:${declaration.line + 1 + offset}: ` +
                                `argument ${arg} must be read as $${arg}`,
                        );
                    }
                }
            });
        }
    }

    assert.deepEqual(violations, []);
});

test("cycle-spending helpers are never nested inside another call", () => {
    const violations: string[] = [];

    for (const source of sources) {
        const text = callable_scan_text(source);
        const callables = declared_callables();

        for (const call of [...parenthesized_call_sites(text), ...statement_call_sites(text)]) {
            if (callables.get(call.name) === undefined) {
                continue;
            }

            for (const arg of call.args) {
                for (const helper of CYCLE_SPENDING_CALLABLES) {
                    if (new RegExp(`(^|[^\\w])${helper}([^\\w]|$)`).test(arg)) {
                        violations.push(
                            `${source.path}:${line_at(text, call.offset)}: ${helper} nested inside ${call.name}`,
                        );
                    }
                }
            }
        }
    }

    assert.deepEqual(violations, []);
});

test("sprite sources only reference Stage-owned state or builtins", () => {
    const stage_names = stage_state_names();

    for (const source of sources.filter((candidate) => is_sprite_root(candidate.path))) {
        const local_names = collect_declared_names(source, [source.path, ...collect_includes(source)]);

        for (const identifier of referenced_identifiers(source)) {
            assert.ok(
                BUILTIN_NAMES.has(identifier) || stage_names.has(identifier) || local_names.has(identifier),
                `${source.path}: "${identifier}" is neither a builtin nor Stage-owned state`,
            );
        }
    }
});

test("every source references only names its translation unit can resolve", () => {
    // Without a compiler this is the closest available check for a misspelled variable, list,
    // enum, proc, or func name. Locals and arguments count as declared in their own file, and
    // a sprite may also read the Stage's variables, lists, and enums.
    const stage_names = stage_state_names();

    for (const source of sources) {
        const declared = collect_declared_names(source, [source.path, ...collect_includes(source)]);
        const resolvable = is_sprite_root(source.path) ? new Set([...declared, ...stage_names]) : declared;

        for (const identifier of referenced_identifiers(source)) {
            assert.ok(
                BUILTIN_NAMES.has(identifier) || resolvable.has(identifier),
                `${source.path}: "${identifier}" is not declared in this translation unit`,
            );
        }
    }
});

test("every mirrored header declaration has a TypeScript mirror of the same arity", () => {
    for (const header_path of MIRRORED_HEADERS) {
        const source = get_source(header_path);
        const declared = source.declarations.filter(
            (declaration) => declaration.kind === "proc" || declaration.kind === "func",
        );

        for (const declaration of declared) {
            const entry = MIRROR_CONTRACT.find(
                (candidate) => candidate.source === header_path && candidate.declaration === declaration.name,
            );
            assert.ok(entry, `${header_path}: ${declaration.name} is missing from the mirror contract`);
            assert.ok(entry.mirror, `${header_path}: ${declaration.name} must be mirrored`);

            const arity = mirror_arity(entry.mirror ?? "");
            assert.equal(
                arity,
                declaration.args.length,
                `${header_path}: ${declaration.name} takes ${declaration.args.length} arguments, mirror takes ${arity}`,
            );
        }
    }

    // Declarations outside the mirrored headers must still be listed, so adding a helper to a
    // header cannot silently skip the mirror.
    for (const source of sources) {
        for (const declaration of source.declarations) {
            if (declaration.kind !== "proc" && declaration.kind !== "func") {
                continue;
            }

            const entry = MIRROR_CONTRACT.find(
                (candidate) => candidate.source === source.path && candidate.declaration === declaration.name,
            );
            assert.ok(entry, `${source.path}: ${declaration.name} is missing from the mirror contract`);

            if (entry.mirror === null) {
                assert.ok(entry.reason, `${source.path}: ${declaration.name} needs a reason for not being mirrored`);
            }
        }
    }

    // Every contract entry must point at a real declaration and a real mirror.
    for (const entry of MIRROR_CONTRACT) {
        const source = get_source(entry.source);
        const declaration = source.declarations.find((candidate) => candidate.name === entry.declaration);
        assert.ok(declaration, `${entry.source}: contract names undeclared ${entry.declaration}`);

        if (entry.mirror !== null) {
            const arity = mirror_arity(entry.mirror);
            assert.equal(
                arity,
                declaration?.args.length,
                `${entry.mirror} takes ${arity} arguments, ${entry.declaration} takes ${declaration?.args.length}`,
            );
        }
    }
});

test("the ported board enums match the mirror's constants", () => {
    // The .gs sources are not executed here, so a wrong literal in one of them would only show up
    // in a compiled project. Comparing the enum values with the mirror's constants catches it: a
    // trainer offset of 1024 instead of $1000, or a window that starts at the wrong address, fails
    // here rather than silently mapping the wrong bytes.
    for (const [file, enumeration, constants] of [
        ["src/mapper.gs", "mapper_error", ported.MAPPER_ERROR],
        ["src/mapper_000.gs", "nrom_limit", ported.NROM_LIMIT],
        ["src/mapper_000.gs", "nrom_window", ported.NROM_WINDOW],
        ["src/mapper_004.gs", "mmc3_limit", ported.MMC3_LIMIT],
        ["src/mapper_004.gs", "mmc3_register", ported.MMC3_REGISTER],
        ["src/mapper_004.gs", "mmc3_op", ported.MMC3_OP],
        ["src/mapper_004.gs", "mmc3_ppu_access", ported.MMC3_PPU_ACCESS],
        ["src/cpu_core.gs", "cpu_vector_address", ported.CPU_VECTOR_ADDRESS],
        ["src/keyboard_input.gs", "keyboard_button", ported.KEYBOARD_BUTTON],
        ["src/rom_input.gs", "rom_input_error", ported.ROM_INPUT_ERROR],
        ["src/rom_input.gs", "rom_input_limit", ported.ROM_INPUT_LIMIT],
    ] as const) {
        const variants = get_enum(get_source(file), enumeration);
        const expected = Object.entries(constants);
        assert.equal(variants.size, expected.length, `${enumeration} has an entry the mirror lacks`);

        for (const [name, value] of variants) {
            const mirror_name = name.toUpperCase();
            const mirror_value = (constants as unknown as Record<string, number>)[mirror_name];
            assert.ok(mirror_value !== undefined, `${file} ${enumeration}.${name} is mirrored as ${mirror_name}`);
            assert.equal(value, mirror_value, `${file} ${enumeration}.${name} is ${mirror_value}`);
        }
    }
});

test("the self-test suite ids match the shared vector fixture", () => {
    const self_test = get_source("src/vector_selftest.gs");
    const suites = get_enum(self_test, "port_suite");

    for (const suite of shared_port_fixture.suites) {
        assert.equal(
            suites.get(suite.name),
            suite.id,
            `port_suite.${suite.name} must equal fixture suite id ${suite.id}`,
        );
    }

    assert.equal(suites.size, shared_port_fixture.suites.length, "port_suite has an entry the fixture lacks");

    // The dispatcher must name exactly the suites the port implements today.
    const dispatcher = self_test.declarations.find((declaration) => declaration.name === "run_next_port_vector");
    assert.ok(dispatcher, "run_next_port_vector is missing");
    const dispatcher_body = dispatcher?.body.join("\n") ?? "";
    const handled = new Set(
        (dispatcher_body.match(/port_suite\.(\w+)/g) ?? []).map((match) => match.slice("port_suite.".length)),
    );
    assert.deepEqual(
        [...handled].sort(),
        [
            "alu",
            "bus",
            "cartridge",
            "cartridge_bus",
            "controller",
            "cpu_addressing",
            "cpu_control",
            "cpu_instruction",
            "cpu_opcode",
            "cpu_sequence",
            "mmc3",
            "mmc3_irq",
            "nrom",
            "nrom_memory",
            "numeric",
            "ppu",
        ],
    );

    const skipped = shared_port_fixture.suites
        .filter((suite) => !handled.has(suite.name))
        .map((suite) => suite.name)
        .sort();
    assert.deepEqual(skipped, ["apu", "cpu", "mapper"], "unported suites must stay skipped, not passing");
});

test("the vector handlers replay against the same bus environment as the reference", () => {
    // The TypeScript reference replays the bus suite without devices (operation 1) and with
    // live controller ports (operation 2), and replays the CPU suites with no devices at all.
    // The port keeps its PPU and controller windows live (APU is stubbed and not live), so a record has to detach the
    // devices the reference leaves absent, or the two sides see different open-bus bytes.
    const self_test = get_source("src/vector_selftest.gs");

    for (const handler_name of [
        "run_bus_vector",
        "run_cpu_addressing_vector",
        "run_cpu_sequence_vector",
        "run_cpu_instruction_vector",
        "run_cpu_control_vector",
        "run_cartridge_bus_vector",
    ]) {
        const handler = self_test.declarations.find((declaration) => declaration.name === handler_name);
        assert.ok(handler, `${handler_name} is missing`);
        assert.match(
            handler?.body.join("\n") ?? "",
            /port_detach_bus_devices;/,
            `${handler_name} must detach the devices the reference replays without`,
        );
    }

    const bus_handler = self_test.declarations.find((declaration) => declaration.name === "run_bus_vector");
    assert.match(
        bus_handler?.body.join("\n") ?? "",
        /cpu_bus_controllers_attached = 1;/,
        "the bus suite must reattach the controller ports for the operation that replays with them",
    );

    // The bus itself has to honor the flags, or detaching a device changes nothing.
    const bus_source = get_source("src/cpu_bus.gs");
    const bus_body = bus_source.declarations
        .filter((declaration) => declaration.kind === "proc" || declaration.kind === "func")
        .map((declaration) => declaration.body.join("\n"))
        .join("\n");
    assert.match(bus_body, /cpu_bus_ppu_attached == 1/, "the PPU window must follow its attachment flag");
    assert.match(
        bus_body,
        /cpu_bus_controllers_attached == 1/,
        "the controller window must follow its attachment flag",
    );
});

test("the CPU bus keeps the PPU window inside its address bound", () => {
    // The PPU register window is $2000-$3FFF and the cartridge window is $4020-$FFFF. A read
    // of a cartridge address must reach the board, because the reset vector lives at $FFFC and
    // the PPU mirrors its registers every eight bytes. A window that answered every address
    // would answer $FFFC as PPU register 4 and $FFFF as PPUDATA, so the console would boot
    // from the wrong vector and never run the game.
    // The PRG fast path (>=32768) may appear before the PPU window because the ranges are
    // disjoint (PPU <16384, PRG >=32768), so the cartridge check is allowed either side.
    const bus = get_source("src/cpu_bus.gs");
    const read = bus.declarations.find((declaration) => declaration.name === "cpu_bus_read");
    assert.ok(read, "cpu_bus_read is missing");

    const body = read.body.join("\n");
    const window = body.indexOf("if numeric_address < 16384 {");
    assert.ok(window >= 0, "the PPU window of cpu_bus_read is missing");

    const attached = body.indexOf("if cpu_bus_ppu_attached == 1 {");
    assert.ok(attached >= 0, "the PPU window does not follow its attachment flag");
    assert.ok(
        attached > window,
        "the attachment check has to be inside the PPU window, not in place of it",
    );

    const cartridge = body.indexOf("if cpu_bus_cartridge_kind ==");
    assert.ok(cartridge >= 0, "the cartridge window is missing");
});

test("the CPU bus decodes the RAM window before the PPU window", () => {
    // The reference decoder returns for the RAM window first, so a RAM write never reaches
    // a PPU register. A port that answered the PPU window first would write $2000-$3FFF's
    // registers on every RAM write, which corrupts the scroll, the mask, and the OAM address
    // while the game runs, and the two sides would no longer agree.
    const bus = get_source("src/cpu_bus.gs");
    const write = bus.declarations.find((declaration) => declaration.name === "cpu_bus_write");
    assert.ok(write, "cpu_bus_write is missing");

    const body = write.body.join("\n");
    const ram = body.indexOf("if numeric_address < 8192 {");
    assert.ok(ram >= 0, "the RAM window of cpu_bus_write is missing");

    const ppu = body.indexOf("elif numeric_address < 16384 {");
    assert.ok(ppu >= 0, "the PPU window of cpu_bus_write has to follow the RAM window");
    assert.ok(ppu > ram, "the RAM window has to be decoded before the PPU window");
});

test("the console boot starts from a cleared console", () => {
    // A fresh console starts with cleared RAM and no pending DMA transfer, and the shared
    // vector replay leaves values in both. A boot that kept them would read a stale latch
    // during the reset sequence and would not match the reference console.
    const bus = get_source("src/cpu_bus.gs");
    const reset = bus.declarations.find((declaration) => declaration.name === "cpu_bus_reset");
    assert.ok(reset, "cpu_bus_reset is missing");

    const reset_body = reset.body.join("\n");
    assert.match(
        reset_body,
        /cpu_dma_phase = cpu_dma_phase\.idle;/,
        "the bus reset has to drop a pending OAM DMA transfer",
    );
    assert.match(
        reset_body,
        /cpu_dma_alignment_cycle_needed = 0;/,
        "the bus reset has to clear the DMA alignment flag",
    );

    const rom_run = get_source("src/rom_run.gs");
    const start = rom_run.declarations.find((declaration) => declaration.name === "rom_run_start");
    assert.ok(start, "rom_run_start is missing");
    assert.match(
        start.body.join("\n"),
        /cpu_bus_clear_ram;/,
        "the boot has to clear the RAM the self test left values in",
    );
});

test("the Stage boots the embedded ROM after the shared-vector self test", () => {
    // The green flag has to do both jobs in order: replay the vectors, then boot the console
    // with the embedded image and keep it running. The display sprite can only report, so it
    // reads the Stage-owned status text.
    const stage = get_source("stage.gs");
    const on_flag = stage.text.match(/onflag \{([\s\S]*?)\n\}/);

    assert.ok(on_flag, "stage.gs has no onflag block");
    const body = on_flag?.[1] ?? "";

    const self_test_at = body.indexOf("run_port_self_test;");
    const boot_at = body.indexOf("rom_run_start;");
    const loop_at = body.indexOf("rom_run_loop;");

    assert.ok(self_test_at >= 0, "the green flag must run the shared-vector self test");
    assert.ok(boot_at > self_test_at, "the ROM must boot after the self test");
    assert.ok(loop_at > boot_at, "the console must run after it boots");

    const rom_run = get_source("src/rom_run.gs");
    const start = rom_run.declarations.find((declaration) => declaration.name === "rom_run_start");
    assert.ok(start, "rom_run_start is missing");
    assert.match(
        start?.body.join("\n") ?? "",
        /cartridge_load_board;/,
        "the boot must load the embedded image and attach its board",
    );
    assert.match(
        start?.body.join("\n") ?? "",
        /cpu_execute_reset_cycles;/,
        "the boot must spend the reset accesses the board answers",
    );
    assert.match(
        start?.body.join("\n") ?? "",
        /cpu_access_log_enabled = 0;/,
        "a running game must not grow the bus-access log",
    );

    const self_test = get_source("src/vector_selftest.gs");
    const replay = self_test.declarations.find((declaration) => declaration.name === "run_port_self_test");
    assert.match(
        replay?.body.join("\n") ?? "",
        /cpu_access_log_enabled = 1;/,
        "the self test must log the accesses it compares",
    );

    const sprite = get_source("main.gs");
    assert.match(sprite.text, /say rom_run_state_text;/, "the display sprite must report the ROM status");
});

test("the run loop services a ROM load request before it runs any more cycles", () => {
    // A pasted image replaces cartridge_bytes, which the board and the CPU read every cycle,
    // so the swap has to happen with the console stopped. The loop samples the load key and
    // services a request at the top of an iteration instead of answering a key-press hat,
    // which would run while the frame loop kept clocking the console.
    const rom_run = get_source("src/rom_run.gs");
    assert.ok(rom_run.includes.includes("src/rom_input.gs"), "the run loop must include the ROM input header");

    const loop = rom_run.declarations.find((declaration) => declaration.name === "rom_run_loop");
    assert.ok(loop, "rom_run_loop is missing");
    const loop_body = loop.body.join("\n");
    const poll_at = loop_body.indexOf("rom_input_poll_key;");
    const service_at = loop_body.indexOf("rom_run_load_input_image;");
    const chunk_at = loop_body.indexOf("frame_loop_run_chunk;");

    assert.ok(poll_at >= 0, "the run loop must sample the ROM load key");
    assert.match(loop_body, /if rom_input_requested == 1 \{/, "the run loop must service a pending request");
    assert.ok(service_at > poll_at, "a request is serviced by the sample that recorded it");
    assert.ok(chunk_at > service_at, "the console must not run cycles while a load is pending");

    // The load itself: ask, decode, validate, and only then install and reboot.
    const load = rom_run.declarations.find((declaration) => declaration.name === "rom_run_load_input_image");
    assert.ok(load, "rom_run_load_input_image is missing");
    const load_body = load.body.join("\n");
    const ask_at = load_body.indexOf("rom_input_ask_for_text;");
    const parse_at = load_body.indexOf("rom_input_parse_text;");
    const validate_at = load_body.indexOf("rom_input_validate_image;");
    const install_at = load_body.indexOf("rom_input_install_image;");
    const boot_at = load_body.indexOf("rom_run_start;");

    assert.ok(ask_at >= 0 && parse_at > ask_at, "the decode reads the answer the ask block collected");
    assert.ok(validate_at > parse_at, "the staged image is validated after it is decoded");
    assert.ok(install_at > validate_at, "nothing is installed before the staged image validates");
    assert.ok(boot_at > install_at, "the console reboots from the image the install wrote");
    assert.match(
        load_body,
        /if rom_input_error_code == rom_input_error\.none \{/,
        "the install has to follow the error check, not precede it",
    );
    assert.match(load_body, /broadcast "rom image changed";/, "the display sprite must report the outcome");
    assert.match(load_body, /rom_input_key_held = 1;/, "the press that opened the prompt must not open another");

    const sprite = get_source("main.gs");
    assert.match(sprite.text, /on "rom image changed" \{/, "the sprite must answer the image-changed broadcast");

    // A rejected paste has to leave the running image alone, so only the install touches the
    // embedded list; the decode writes its own staging list.
    const rom_input = get_source("src/rom_input.gs");
    const parse = rom_input.declarations.find((declaration) => declaration.name === "rom_input_parse_text");
    const install = rom_input.declarations.find((declaration) => declaration.name === "rom_input_install_image");
    assert.ok(parse && install, "the decode and the install are missing");
    assert.ok(!parse.body.join("\n").includes("cartridge_bytes"), "the decode must not write the embedded image");
    assert.match(install.body.join("\n"), /delete cartridge_bytes;/, "the install replaces the embedded image");
    assert.match(parse.body.join("\n"), /rom_input_limit\.max_bytes/, "the decode must respect the list limit");
    assert.match(parse.body.join("\n"), /rom_input_limit\.max_text_chars/, "the decode must bound the text it reads");
    assert.match(
        parse.body.join("\n"),
        /\(\"0x\" & character\) \+ ""/,
        "the decode must read one hexadecimal digit at a time through Scratch's number cast",
    );
    assert.match(parse.body.join("\n"), /pending_nibble \* 16/, "two hexadecimal nibbles must make one byte");
    assert.match(parse.body.join("\n"), /rom_input_error\.odd_digits/, "a leftover digit must be a reported error");

    // The load key has to stay out of the pad bindings, or loading a ROM would press a button.
    const keyboard = get_source("src/keyboard_input.gs");
    assert.ok(!keyboard.text.includes('key_pressed("q")'), "the ROM load key must not drive a pad button");
});

test("the ported pen palette literals match the mirrored palette planes", () => {
    // The .gs palette is 192 literal channel values that no test executes, so a transposed
    // digit would only show up as a wrong color in a compiled project. Parsing the init
    // assignments and comparing them with the mirror planes (which the algorithm suite in
    // turn compares with the canvas renderer's palette) keeps all three tables equal.
    const palette = get_source("src/nes_palette.gs");

    for (const [list_name, mirror_plane] of [
        ["nes_palette_red", ported.NES_PALETTE_RED],
        ["nes_palette_green", ported.NES_PALETTE_GREEN],
        ["nes_palette_blue", ported.NES_PALETTE_BLUE],
    ] as const) {
        const values = new Array<number>(64).fill(-1);

        for (const match of palette.text.matchAll(new RegExp(`${list_name}\\[(\\d+)\\] = (\\d+);`, "g"))) {
            const slot = Number(match[1]);
            assert.ok(slot >= 1 && slot <= 64, `${list_name} slot ${slot} is outside the palette`);
            assert.equal(values[slot - 1], -1, `${list_name} slot ${slot} is assigned twice`);
            values[slot - 1] = Number(match[2]);
        }

        assert.ok(!values.includes(-1), `${list_name} must assign all 64 palette slots`);
        assert.deepEqual(values, [...mirror_plane], `${list_name} must hold the mirrored channel plane`);
    }
});

test("the display sprite draws each finished frame with the pen extension in color", () => {
    // The Stage owns the console but cannot move or use the pen, so a finished frame is
    // presented by the display sprite. The handoff has to be a broadcast the Stage waits on:
    // a frame the sprite drew while the PPU was already rendering the next one would tear.
    const ppu = get_source("src/ppu_2c02.gs");
    const clock_dot = ppu.declarations.find((declaration) => declaration.name === "ppu_clock_ppu_dot");
    assert.ok(clock_dot, "ppu_clock_ppu_dot is missing");
    const clock_body = clock_dot.body.join("\n");
    assert.match(clock_body, /ppu_frame_ready = 1;/, "vblank start must offer the finished frame");

    const render_at = clock_body.indexOf("ppu_render_pixel;");
    const pipeline_at = clock_body.indexOf("ppu_clock_rendering_pipeline;");
    const advance_at = clock_body.indexOf("ppu_advance_dot;");
    assert.ok(render_at >= 0 && pipeline_at > render_at, "each dot renders its pixel before the fetch pipeline");
    assert.ok(advance_at > pipeline_at, "each dot advances only after it renders");

    const stage = get_source("stage.gs");
    assert.match(stage.text, /nes_palette_init;/, "the green flag must build the pen colors before the run");

    const rom_run = get_source("src/rom_run.gs");
    const loop = rom_run.declarations.find((declaration) => declaration.name === "rom_run_loop");
    assert.ok(loop, "rom_run_loop is missing");
    const loop_body = loop.body.join("\n");
    const clear_at = loop_body.indexOf("ppu_frame_ready = 0;");
    const draw_at = loop_body.indexOf('broadcast_and_wait "draw frame";');
    assert.match(loop_body, /if ppu_frame_ready == 1 \{/, "the run loop must present only finished frames");
    assert.ok(clear_at >= 0 && draw_at > clear_at, "the flag clears before the sprite draws the frame");
    const geometry_at = loop_body.indexOf("pen_display_update_geometry;");
    assert.ok(
        geometry_at > clear_at && geometry_at < draw_at,
        "the pen geometry is recomputed from the fit setting before the sprite draws",
    );

    const sprite = get_source("main.gs");
    assert.match(sprite.text, /on "draw frame" \{/, "the sprite must answer the frame broadcast");
    assert.match(sprite.text, /erase_all;/, "each frame must start from a cleared pen layer");
    assert.match(sprite.text, /pen_down;/, "runs are drawn with the pen down");
    assert.match(sprite.text, /pen_up;/, "the pen lifts between runs");
    assert.match(sprite.text, /set_pen_size pen_display_scale;/, "the pen size is the stage-units-per-pixel scale");
    assert.match(
        sprite.text,
        /set_pen_color nes_pen_colors\[/,
        "runs take their RGB color from the cached palette/emphasis colors",
    );
    assert.match(sprite.text, /ppu_framebuffer_packed\[/, "the sprite reads the packed framebuffer");
    assert.match(
        sprite.text,
        /goto pen_display_first_x \+ \(\$left_x \* pen_display_scale\), \$stage_y;/,
        "NES x maps onto the centered, scaled stage x",
    );
    assert.match(
        sprite.text,
        /stage_y = pen_display_first_y - \(row \* pen_display_scale\);/,
        "rows step down from the centered, scaled top row",
    );

    const config = readFileSync(join(SCRATCH_DIRECTORY, "goboscript.toml"), "utf8");
    assert.match(config, /high_quality_pen = true/, "TurboWarp renders the pen layer at display resolution");
});

test("the PPU bus reports pattern and nametable accesses to an attached MMC3 board", () => {
    // The reference bus observes every pattern and nametable access before running it, and
    // the MMC3 scanline IRQ clocks from those addresses. A ported renderer that fetched
    // tiles without the observation would never raise a scanline IRQ, so the sprite/background
    // split games rely on would stick. Palette accesses are not part of the observation.
    const bus = get_source("src/ppu_bus.gs");

    for (const [proc_name, kind] of [
        ["ppu_bus_read_ppu", "read"],
        ["ppu_bus_write_ppu", "write"],
    ] as const) {
        const declaration = bus.declarations.find((candidate) => candidate.name === proc_name);
        assert.ok(declaration, `${proc_name} is missing`);
        const body = declaration.body.join("\n");
        const observations = body.match(new RegExp(`ppu_bus_observe_access ppu_bus_access\\.${kind}, ppu_address;`, "g"));
        assert.equal(observations?.length, 2, `${proc_name} observes its pattern and nametable windows only`);
        assert.match(body, /elif ppu_address < 16128 \{/, `${proc_name} starts the palette window at $3F00`);
    }

    const read = bus.declarations.find((declaration) => declaration.name === "ppu_bus_read_ppu");
    const read_body = read?.body.join("\n") ?? "";
    assert.ok(
        read_body.indexOf("ppu_bus_observe_access") < read_body.indexOf("ppu_bus_read_pattern"),
        "a pattern read is observed before it reaches the board, like the reference bus",
    );

    const observe = bus.declarations.find((declaration) => declaration.name === "ppu_bus_observe_access");
    assert.ok(observe, "ppu_bus_observe_access is missing");
    assert.match(
        observe.body.join("\n"),
        /mmc3_observe_ppu_access \$access_kind, \$address;/,
        "an attached MMC3 board receives the access for its A12 filter",
    );
});

test("the ported PPU and pen display constants match the reference values", () => {
    // The port spells its constants as decimal literals where the reference uses hex or
    // named expressions, which is exactly where a transcription slip hides: the pen
    // renderer audit caught the second PPUSCROLL preserve mask at 3099 instead of
    // 3103 ($0C1F), silently dropping coarse X bit two. Every numeric constant the
    // two PPU implementations share by name must agree, and the pen display header
    // must frame the same 256 by 240 picture the PPU renders, because the sprite
    // geometry is computed from the pen header's copies.
    const reference_text = readFileSync(
        fileURLToPath(new URL("../src/nes/ppu/ppu_2c02.ts", import.meta.url)),
        "utf8",
    );
    const reference_constants = new Map<string, number>();

    for (const match of reference_text.matchAll(/^const ([A-Z][A-Z0-9_]*) = (0x[0-9a-f]+|\d+);$/gim)) {
        reference_constants.set(match[1] as string, Number(match[2]));
    }

    assert.ok(reference_constants.size > 40, "the reference constant scan must find the PPU constants");

    const ppu = get_source("src/ppu_2c02.gs");
    let compared = 0;

    for (const match of ppu.text.matchAll(/^var ([A-Z][A-Z0-9_]*) = (\d+);$/gm)) {
        const reference_value = reference_constants.get(match[1] as string);

        if (reference_value !== undefined) {
            compared += 1;
            assert.equal(Number(match[2]), reference_value, `${match[1]} must match the reference PPU`);
        }
    }

    assert.ok(compared > 40, "most ported PPU constants are shared with the reference by name");

    const pen_display = get_source("src/pen_display.gs");
    assert.match(pen_display.text, /^var PEN_FRAME_WIDTH = 256;$/m, "the pen frame width is the PPU width");
    assert.match(pen_display.text, /^var PEN_FRAME_HEIGHT = 240;$/m, "the pen frame height is the PPU height");
    assert.match(pen_display.text, /^var pen_fit_to_screen = 1;$/m, "fit-to-screen starts on, at the 1.5x fit scale");
    assert.match(
        pen_display.text,
        /^var pen_display_scale = 1\.5;$/m,
        "the starting scale is the one the default setting selects",
    );
    assert.match(
        pen_display.text,
        /^var pen_display_first_x = -191\.25;$/m,
        "the starting first-pixel x is the fit-scale first pixel center",
    );
    assert.match(
        pen_display.text,
        /^var pen_display_first_y = 179\.25;$/m,
        "the starting first-pixel y is the fit-scale first pixel center",
    );
});

test("mask arithmetic divides by mask-plus-one at every ported use site", () => {
    // GoboScript has no bitwise operators, so `value & MASK` is spelled `value % (MASK + 1)`:
    // the floored modulo lands on the same bits only when the divisor is the mask plus one.
    // Dividing by the mask value itself is wrong for at least one input, and a run of those
    // hid in the renderer's use sites even though the constants test pinned the masks: fine X
    // came out as value % 7, the 14-bit VRAM access as vram % 16383, the sprite palette bits
    // as attributes % 3, and the six-bit color index as palette % 63. A modulo whose divisor
    // is a named mask is wrong by construction, so none may appear anywhere in the port.
    const violations: string[] = [];

    for (const source of sources) {
        for (const [index, line] of source.lines.entries()) {
            for (const match of strip_comments_and_strings(line).matchAll(/%\s*([\w.]+)/g)) {
                const divisor = match[1] ?? "";

                if (/mask/i.test(divisor)) {
                    violations.push(`${source.path}:${index + 1}: % ${divisor} divides by a bit mask`);
                }
            }
        }
    }

    assert.deepEqual(violations, []);

    // The fixed use sites stay pinned so a literal regression is caught even before the
    // generic scan could see it, and so a refactor keeps the same mask-plus-one arithmetic.
    const ppu = get_source("src/ppu_2c02.gs");
    assert.match(ppu.text, /fine_x = \$value % 8;/, "the fine-X field is value & $07");
    assert.equal(
        (ppu.text.match(/ppu_vram_address % 16384/g) ?? []).length,
        4,
        "the four VRAM access sites mask the address to $3FFF",
    );
    assert.match(ppu.text, /ppu_sprite_pixel_attributes % 4/, "the sprite palette field is attributes & $03");
    assert.match(
        ppu.text,
        /ppu_palette_ram\[palette_offset \+ 1\] % 64/,
        "the six-bit color index is the palette byte & $3F",
    );

    // APU is stubbed (no triangle channel); the mask-divide-by-plus-one invariant is
    // covered by the generic violations scan above and the PPU pinned sites below.
    const apu = get_source("src/apu_2a03.gs");
    assert.match(apu.text, /apu_2a03: no-audio stub/, "the stub file must identify itself");
});

test("the self-test operation ids match the shared vector fixture operations", () => {
    const self_test = get_source("src/vector_selftest.gs");
    const numeric_operations = fixture_operations("numeric");
    const numeric_enum = get_enum(self_test, "numeric_op");
    assert.deepEqual(
        [...numeric_enum.values()].sort((first, second) => first - second),
        contiguous_ids(numeric_enum.size),
        "numeric_op ids must be contiguous from one",
    );
    assert.deepEqual(
        [...numeric_operations].sort((first, second) => first - second),
        [...numeric_enum.values()].sort((first, second) => first - second),
    );

    const alu_operations = fixture_operations("alu");
    const alu_enum = get_enum(self_test, "alu_op");
    assert.deepEqual(
        [...alu_enum.values()].sort((first, second) => first - second),
        contiguous_ids(alu_enum.size),
        "alu_op ids must be contiguous from one",
    );
    assert.deepEqual(
        [...alu_operations].sort((first, second) => first - second),
        [...alu_enum.values()].sort((first, second) => first - second),
    );

    assert.deepEqual(
        [...fixture_operations("bus")].sort(),
        [1, 2],
        "bus operations are 1 (no devices attached) and 2 (live controllers)",
    );
    assert.deepEqual([...fixture_operations("controller")], [1], "controller operation 1 is the only defined shape");
    assert.deepEqual([...fixture_operations("cartridge")], [1], "cartridge operation 1 is the only defined shape");

    // Suite 10 operations are the addressing modes, so the ported mode enum is the id list.
    const addressing_operations = fixture_operations("cpu_addressing");
    const addressing_enum = get_enum(get_source("src/cpu_addressing.gs"), "cpu_addressing_mode");
    assert.deepEqual(
        [...addressing_enum.values()].sort((first, second) => first - second),
        contiguous_ids(addressing_enum.size),
        "cpu_addressing_mode ids must be contiguous from one",
    );
    assert.deepEqual(
        [...addressing_operations].sort((first, second) => first - second),
        [...addressing_enum.values()].sort((first, second) => first - second),
    );

    // Suite 11 operations are the ported cycle sequences.
    const sequence_enum = get_enum(get_source("src/cpu_sequence.gs"), "cpu_sequence_op");
    assert.deepEqual(
        [...sequence_enum.values()].sort((first, second) => first - second),
        contiguous_ids(sequence_enum.size),
        "cpu_sequence_op ids must be contiguous from one",
    );
    assert.deepEqual(
        [...fixture_operations("cpu_sequence")].sort((first, second) => first - second),
        [...sequence_enum.values()].sort((first, second) => first - second),
    );

    // Suite 12 has one operation per record, so its ids are checked against the generated opcode
    // table instead: the ported mnemonic enum must name exactly the fixture's 76 mnemonics with
    // the fixture's ids, and the field enum must hold the record offsets the decoder adds.
    assert.deepEqual([...fixture_operations("cpu_opcode")], [1], "opcode decoding has one operation");

    const opcode_source = get_source("src/cpu_opcode.gs");
    const mnemonic_enum = get_enum(opcode_source, "cpu_mnemonic");
    const mnemonic_ids = cpu_mnemonic_ids();
    assert.equal(mnemonic_enum.size, mnemonic_ids.size, "the ported enum names every fixture mnemonic");
    assert.deepEqual(
        [...mnemonic_enum.values()].sort((first, second) => first - second),
        contiguous_ids(mnemonic_enum.size),
        "cpu_mnemonic ids must be contiguous from one",
    );

    for (const [mnemonic, id] of mnemonic_ids) {
        assert.equal(mnemonic_enum.get(`op_${mnemonic.toLowerCase()}`), id, `cpu_mnemonic.op_${mnemonic}`);
    }

    // Suite 13 executes one instruction per record, so it has a single operation, and the
    // dispatcher's reach has to agree three ways: the mnemonics named in the .gs dispatch
    // chains, the ids the mirror declares, and the ported set the projection refuses to derive
    // an executed record for. A mnemonic missing from any of the three would let an unported
    // instruction pass as executed, or an executed one be recorded as refused.
    assert.deepEqual([...fixture_operations("cpu_instruction")], [1], "instruction execution has one operation");

    // Suite 14 runs the control loop, so it also has one operation per record, and its sequence
    // kind ids must be the ones the ported enum reports.
    assert.deepEqual([...fixture_operations("cpu_control")], [1], "the control loop has one operation");

    // Suite 15 validates one board per record, so it has one operation as well, and suite 16 runs
    // that board's memory operations under the same single operation id.
    assert.deepEqual([...fixture_operations("nrom")], [1], "board validation has one operation");
    assert.deepEqual([...fixture_operations("nrom_memory")], [1], "board memory has one operation");
    assert.deepEqual([...fixture_operations("cartridge_bus")], [1], "the cartridge bus has one operation");
    assert.deepEqual([...fixture_operations("mmc3")], [1], "an MMC3 board has one operation");
    assert.deepEqual([...fixture_operations("mmc3_irq")], [1], "an MMC3 IRQ record has one operation");

    // The MMC3 operation kinds the self-test dispatches are the projection's ids.
    const mmc3_ops = get_enum(get_source("src/mapper_004.gs"), "mmc3_op");
    assert.deepEqual(
        [...mmc3_ops.entries()]
            .map(([name, id]) => ({ id, name: name.replace(/_/g, "-") }))
            .sort((first, second) => first.id - second.id),
        [...MMC3_OPS],
        "the ported MMC3 operation ids are the projection's ids",
    );

    // The memory operation kinds the self-test dispatches are the projection's ids.
    const memory_ops = get_enum(get_source("src/mapper_000.gs"), "nrom_memory_op");
    assert.deepEqual(
        [...memory_ops.entries()]
            .map(([name, id]) => ({ id, name: name.replace(/_/g, "-") }))
            .sort((first, second) => first.id - second.id),
        [...NROM_MEMORY_OPS],
        "the ported memory operation ids are the projection's ids",
    );

    const sequence_kinds = get_enum(get_source("src/cpu_control.gs"), "cpu_sequence_kind");
    assert.deepEqual(
        [...sequence_kinds.entries()]
            .map(([name, id]) => ({ id, name }))
            .sort((first, second) => first.id - second.id),
        [...CPU_CONTROL_SEQUENCE_KINDS],
        "the ported sequence kind ids are the projection's ids",
    );

    const dispatched = new Set(
        (get_source("src/cpu_instruction.gs").text.match(/cpu_mnemonic\.op_(\w+)/g) ?? []).map((match) =>
            match.slice("cpu_mnemonic.op_".length),
        ),
    );
    const mirrored_mnemonics = Object.keys(ported.CPU_MNEMONIC).map((name) => name.toLowerCase());
    assert.deepEqual([...dispatched].sort(), mirrored_mnemonics.sort(), "the mirror declares the dispatched set");
    assert.deepEqual(
        [...dispatched].sort(),
        CPU_INSTRUCTION_PORTED_MNEMONICS.map((name) => name.toLowerCase()).sort(),
        "the projection's ported set is the dispatched set",
    );

    const field_enum = get_enum(opcode_source, "cpu_opcode_field");
    assert.equal(field_enum.size, opcode_table_fixture().field_count, "the field enum covers every table field");
    assert.deepEqual(
        [...field_enum.values()].sort((first, second) => first - second),
        Array.from({ length: field_enum.size }, (_, index) => index),
        "cpu_opcode_field ids are the record offsets, contiguous from zero",
    );
});

function fixture_operations(suite_name: string): number[] {
    const suite = shared_port_fixture.suites.find((candidate) => candidate.name === suite_name);
    assert.ok(suite, `Missing shared vector suite ${suite_name}.`);
    return [...new Set(suite.vectors.map((vector) => vector.operation))];
}

function contiguous_ids(count: number): number[] {
    return Array.from({ length: count }, (_, index) => index + 1);
}

function load_sources(): GsSource[] {
    const entries = readdirSync(SCRATCH_DIRECTORY, { recursive: true, withFileTypes: true });
    const paths = entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".gs"))
        .map((entry) => relative(SCRATCH_DIRECTORY, join(entry.parentPath, entry.name)).replaceAll("\\", "/"))
        .sort();

    return paths.map((path) => parse_source(path, readFileSync(join(SCRATCH_DIRECTORY, path), "utf8")));
}

function parse_source(path: string, text: string): GsSource {
    const lines = text.split("\n");

    if (lines.at(-1) === "") {
        lines.pop();
    }

    const declarations: GsDeclaration[] = [];
    const enums: GsEnum[] = [];
    const includes: string[] = [];

    for (const [index, line] of lines.entries()) {
        const include = /^%include (\S+)$/.exec(line);

        if (include?.[1] !== undefined) {
            includes.push(`${include[1]}.gs`);
            continue;
        }

        const variable = /^var (\w+)(?: =.*)?;$/.exec(line);

        if (variable?.[1] !== undefined) {
            declarations.push({ kind: "var", name: variable[1], args: [], warp: false, body: [], line: index + 1 });
            continue;
        }

        const list = /^list (\w+)(?: .*?)?;$/.exec(line);

        if (list?.[1] !== undefined) {
            declarations.push({ kind: "list", name: list[1], args: [], warp: false, body: [], line: index + 1 });
            continue;
        }

        const enumeration = /^enum (\w+) \{$/.exec(line);

        if (enumeration?.[1] !== undefined) {
            const variants = new Map<string, number>();
            let cursor = index + 1;

            while (cursor < lines.length && lines[cursor] !== "}") {
                const variant = /^\s+(\w+) = (-?\d+),?$/.exec(lines[cursor] ?? "");

                if (variant?.[1] !== undefined && variant[2] !== undefined) {
                    variants.set(variant[1], Number(variant[2]));
                }

                cursor += 1;
            }

            assert.equal(lines[cursor], "}", `${path}:${index + 1}: unterminated enum ${enumeration[1]}`);
            enums.push({ name: enumeration[1], variants });
            continue;
        }

        const procedure = /^(nowarp )?proc (\w+)(.*?) \{$/.exec(line);

        if (procedure?.[2] !== undefined) {
            const body = read_body(lines, index);
            declarations.push({
                kind: "proc",
                name: procedure[2],
                args: parse_args(procedure[3] ?? ""),
                warp: procedure[1] === undefined,
                body,
                line: index + 1,
            });
            continue;
        }

        const function_declaration = /^func (\w+)\((.*?)\) \{$/.exec(line);

        if (function_declaration?.[1] !== undefined) {
            declarations.push({
                kind: "func",
                name: function_declaration[1],
                args: parse_args(function_declaration[2] ?? ""),
                warp: false,
                body: read_body(lines, index),
                line: index + 1,
            });
        }
    }

    return { path, text, lines, declarations, enums, includes };
}

const BUILTIN_NAMES = new Set([...GOBOSCRIPT_KEYWORDS, ...SCRATCH_BLOCK_NAMES]);

/** The variables, lists, and enums the Stage owns and every sprite may resolve. */
function stage_state_names(): Set<string> {
    const stage = get_source("stage.gs");
    return collect_declared_names(stage, ["stage.gs", ...collect_includes(stage)], true);
}

/**
 * Every name a translation unit can resolve: its own declarations plus included headers.
 * With `state_only` the result is limited to variables, lists, and enums, which is what a
 * sprite may resolve from the Stage; procs and funcs are compiled per target and never cross.
 */
function collect_declared_names(source: GsSource, paths: readonly string[], state_only = false): Set<string> {
    const names = new Set<string>();

    for (const path of new Set(paths)) {
        const unit = path === source.path ? source : get_source(path);

        for (const declaration of unit.declarations) {
            if (state_only && declaration.kind !== "var" && declaration.kind !== "list") {
                continue;
            }

            names.add(declaration.name);

            for (const arg of declaration.args) {
                names.add(arg);
            }

            for (const line of declaration.body) {
                const local = /^\s*local (\w+)\b/.exec(line);

                if (local?.[1] !== undefined) {
                    names.add(local[1]);
                }
            }
        }

        for (const enumeration of unit.enums) {
            names.add(enumeration.name);

            for (const variant of enumeration.variants.keys()) {
                names.add(variant);
            }
        }
    }

    return names;
}

/** Bare identifiers in a source, ignoring comments, string literals, and directives. */
function referenced_identifiers(source: GsSource): string[] {
    const identifiers: string[] = [];

    for (const line of source.lines) {
        if (line.startsWith("%")) {
            continue;
        }

        const stripped = strip_comments_and_strings(line);

        for (const match of stripped.matchAll(/\b[a-z_][a-z0-9_]*\b/g)) {
            identifiers.push(match[0].replace(/^\$/, ""));
        }
    }

    return identifiers;
}

/** Root .gs files outside src/ are targets: stage.gs is the Stage, the rest are sprites. */
interface GsCallable {
    readonly kind: "proc" | "func";
    readonly arity: number;
    readonly path: string;
    readonly line: number;
}

interface GsCallSite {
    readonly name: string;
    readonly args: readonly string[];
    readonly offset: number;
}

/** Every proc and func in the project. Names are unique because a call site cannot say which. */
function declared_callables(): ReadonlyMap<string, GsCallable> {
    const callables = new Map<string, GsCallable>();

    for (const source of sources) {
        for (const declaration of source.declarations) {
            if (declaration.kind !== "proc" && declaration.kind !== "func") {
                continue;
            }

            const existing = callables.get(declaration.name);
            assert.equal(
                existing,
                undefined,
                `${source.path}:${declaration.line}: ${declaration.name} is already declared in ${existing?.path}`,
            );
            callables.set(declaration.name, {
                kind: declaration.kind,
                arity: declaration.args.length,
                path: source.path,
                line: declaration.line,
            });
        }
    }

    return callables;
}

/** The source with comments, strings, and declaration headers removed, keeping line breaks. */
function callable_scan_text(source: GsSource): string {
    return source.lines
        .map((line) => (/^\s*(nowarp\s+)?(proc|func)\s/.test(line) ? "" : strip_comments_and_strings(line)))
        .join("\n");
}

/** Splits an argument list on commas that are not nested in parentheses or brackets. */
function split_top_level_arguments(raw: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let current = "";

    for (const character of raw) {
        if (character === "(" || character === "[") {
            depth += 1;
        } else if (character === ")" || character === "]") {
            depth -= 1;
        }

        if (character === "," && depth === 0) {
            parts.push(current);
            current = "";
            continue;
        }

        current += character;
    }

    parts.push(current);
    return parts.map((part) => part.trim()).filter((part) => part !== "");
}

/** Every `name(...)` call in the text, matched with balanced parentheses. */
function parenthesized_call_sites(text: string): GsCallSite[] {
    const sites: GsCallSite[] = [];
    const pattern = /(^|[^\w.$])([a-z]\w*)\s*\(/g;

    for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
        const name = match[2] ?? "";
        const offset = (match.index ?? 0) + (match[0]?.length ?? 0) - 1;
        let depth = 1;
        let cursor = offset + 1;

        while (cursor < text.length && depth > 0) {
            const character = text[cursor];

            if (character === "(") {
                depth += 1;
            } else if (character === ")") {
                depth -= 1;
            }

            cursor += 1;
        }

        if (depth === 0) {
            sites.push({ name, args: split_top_level_arguments(text.slice(offset + 1, cursor - 1)), offset });
        }
    }

    return sites;
}

/**
 * Every statement-position call. Statements are separated by semicolons and braces, so the
 * first identifier of each fragment is either a keyword, an assignment target, or a proc call.
 */
function statement_call_sites(text: string): GsCallSite[] {
    const sites: GsCallSite[] = [];
    let cursor = 0;

    for (const fragment of text.split(/[;{}]/)) {
        const trimmed = fragment.replace(/^[\s\n]+/, "");
        const offset = cursor + (fragment.length - trimmed.length);
        cursor += fragment.length + 1;
        const head = /^([a-z]\w*)\b([\s\S]*)$/.exec(trimmed);

        if (head === null) {
            continue;
        }

        const rest = (head[2] ?? "").trim();

        if (rest.startsWith("(")) {
            // A parenthesized call is reported by parenthesized_call_sites instead.
            continue;
        }

        sites.push({ name: head[1] ?? "", args: split_top_level_arguments(rest), offset });
    }

    return sites;
}

/** The 1-based line number of a character offset in the scanned text. */
function line_at(text: string, offset: number): number {
    return text.slice(0, offset).split("\n").length;
}

function is_sprite_root(path: string): boolean {
    return path !== "stage.gs" && !path.startsWith("src/");
}

/**
 * Joins wrapped lines into statements. A statement ends at a semicolon or at a brace, so a
 * func body ending in a block reports that block's closing brace as its last statement.
 */
function split_statements(body: readonly string[]): string[] {
    const statements: string[] = [];
    let current: string[] = [];

    for (const raw of body) {
        const line = raw.trim();

        if (line === "" || line.startsWith("#")) {
            continue;
        }

        current.push(line);

        if (line.endsWith(";") || line.endsWith("{") || line.endsWith("}")) {
            statements.push(current.join(" "));
            current = [];
        }
    }

    if (current.length > 0) {
        statements.push(current.join(" "));
    }

    return statements;
}

function parse_args(raw: string): string[] {
    return raw
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part !== "")
        .map((part) => part.split(/\s+/).at(-1) ?? part);
}

/** Returns the body lines between the declaration's opening brace and its matching close. */
function read_body(lines: string[], start: number): string[] {
    let depth = 0;
    const body: string[] = [];

    for (let index = start; index < lines.length; index += 1) {
        const stripped = strip_comments_and_strings(lines[index] ?? "");
        depth += count_character(stripped, "{") - count_character(stripped, "}");

        if (index > start && depth <= 0) {
            return body;
        }

        if (index > start) {
            body.push(lines[index] ?? "");
        }
    }

    assert.fail(`Unterminated block starting at line ${start + 1}.`);
}

function strip_comments_and_strings(line: string): string {
    const without_comment = line.split("#")[0] ?? "";
    return without_comment.replaceAll(/"[^"]*"/g, '""');
}

function count_character(text: string, character: string): number {
    return text.split(character).length - 1;
}

/** Returns the inclusive line ranges of loop bodies inside a declaration body. */
function find_loop_bodies(body: readonly string[]): [number, number][] {
    const ranges: [number, number][] = [];

    for (const [index, line] of body.entries()) {
        const trimmed = line.trim();

        if (!/^(repeat|until|forever)\b/.test(trimmed) || !trimmed.endsWith("{")) {
            continue;
        }

        let depth = 0;

        for (let cursor = index; cursor < body.length; cursor += 1) {
            const stripped = strip_comments_and_strings(body[cursor] ?? "");
            depth += count_character(stripped, "{") - count_character(stripped, "}");

            if (depth <= 0) {
                ranges.push([index, cursor]);
                break;
            }
        }
    }

    return ranges;
}

function get_source(path: string): GsSource {
    const source = sources.find((candidate) => candidate.path === path);
    assert.ok(source, `Missing GoboScript source ${path}.`);
    return source;
}

function get_enum(source: GsSource, name: string): ReadonlyMap<string, number> {
    const enumeration = source.enums.find((candidate) => candidate.name === name);
    assert.ok(enumeration, `${source.path}: missing enum ${name}`);
    return enumeration.variants;
}

function collect_includes(source: GsSource, seen = new Set<string>()): string[] {
    const collected: string[] = [];

    for (const included of source.includes) {
        if (seen.has(included)) {
            continue;
        }

        seen.add(included);
        collected.push(included, ...collect_includes(get_source(included), seen));
    }

    return collected;
}

function mirror_arity(path: string): number {
    const parts = path.split(".");
    const exported = (ported as unknown as Record<string, unknown>)[parts[0] ?? ""];
    assert.ok(exported !== undefined, `Mirror ${path} is not exported.`);

    if (parts.length === 1) {
        assert.equal(typeof exported, "function", `Mirror ${path} is not callable.`);
        return (exported as (...args: unknown[]) => unknown).length;
    }

    const prototype = (exported as { prototype?: Record<string, unknown> }).prototype;
    assert.ok(prototype, `Mirror ${path} has no prototype.`);
    const member = prototype?.[parts[1] ?? ""];
    assert.equal(typeof member, "function", `Mirror ${path} is not a method.`);
    return (member as (...args: unknown[]) => unknown).length;
}
