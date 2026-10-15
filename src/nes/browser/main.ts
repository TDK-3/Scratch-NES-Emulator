import { MAX_ROM_IMAGE_BYTES } from "../cartridge/ines.js";
import { NesConsole } from "../core/nes_console.js";
import type { NesConsoleFrame } from "../core/nes_console.js";
import { NesBrowserBatteryRamStore, fingerprint_rom } from "./battery_ram_store.js";
import type { BrowserKeyValueStorage } from "./battery_ram_store.js";
import { BrowserAudioOutput } from "./audio_output.js";
import { NesBrowserAudioFilter } from "./audio_filter.js";
import { NesCanvasRenderer } from "./canvas_renderer.js";
import { NesBrowserFrameScheduler } from "./frame_scheduler.js";
import { NesBrowserKeyboardInput } from "./keyboard_input.js";

const canvas = get_required_element<HTMLCanvasElement>("nes-screen");
const screen_container = get_required_element<HTMLDivElement>("screen-container");
const runtime_status = get_required_element<HTMLParagraphElement>("runtime-status");
const rom_description = get_required_element<HTMLSpanElement>("rom-description");
const frame_description = get_required_element<HTMLSpanElement>("frame-description");
const mapper_status = get_required_element<HTMLElement>("mapper-status");
const cycle_status = get_required_element<HTMLElement>("cycle-status");
const frame_cycle_status = get_required_element<HTMLElement>("frame-cycle-status");
const audio_status = get_required_element<HTMLElement>("audio-status");
const pc_status = get_required_element<HTMLElement>("pc-status");
const rom_file_input = get_required_element<HTMLInputElement>("rom-file");
const run_button = get_required_element<HTMLButtonElement>("run-console");
const pause_button = get_required_element<HTMLButtonElement>("pause-console");
const reset_button = get_required_element<HTMLButtonElement>("reset-console");
const step_frame_button = get_required_element<HTMLButtonElement>("step-frame");
const step_instruction_button = get_required_element<HTMLButtonElement>("step-instruction");
const load_supplied_rom_button = get_required_element<HTMLButtonElement>("load-supplied-rom");
const load_apu_rom_button = get_required_element<HTMLButtonElement>("load-apu-rom");
const audio_toggle = get_required_element<HTMLInputElement>("audio-output");

const canvas_renderer = new NesCanvasRenderer(canvas);
const audio_output = new BrowserAudioOutput();
const audio_filter = new NesBrowserAudioFilter();
const battery_ram_store = new NesBrowserBatteryRamStore(get_browser_storage());
let nes_console: NesConsole | null = null;
let loaded_rom_name = "";
let loaded_rom_fingerprint: string | null = null;
const keyboard_input = new NesBrowserKeyboardInput((controller_index, button, pressed) => {
    nes_console?.set_button_state(controller_index, button, pressed);
});

const frame_scheduler = new NesBrowserFrameScheduler(
    () => {
        if (nes_console === null) {
            throw new Error("Load a ROM before starting the console.");
        }

        return nes_console.advance_frame();
    },
    (frame) => render_console_frame(frame),
    (error) => {
        if (nes_console !== null) {
            nes_console.pause();
        }

        audio_output.stop();
        audio_filter.reset();
        const battery_save_warning = save_battery_ram();
        const warning_suffix = battery_save_warning === null ? "" : ` ${battery_save_warning}`;
        set_runtime_status(`Emulation stopped: ${format_error(error)}.${warning_suffix}`, true);
        update_controls();
    },
    window.requestAnimationFrame.bind(window),
    window.cancelAnimationFrame.bind(window),
);

rom_file_input.addEventListener("change", () => {
    void load_selected_rom();
});

load_supplied_rom_button.addEventListener("click", () => {
    void load_bundled_rom("/roms/test_rom.nes", "test_rom.nes");
});

load_apu_rom_button.addEventListener("click", () => {
    void load_bundled_rom("/roms/NES_APUTest_SquarePlayer.nes", "NES_APUTest_SquarePlayer.nes");
});

run_button.addEventListener("click", () => {
    void start_emulation();
});

pause_button.addEventListener("click", pause_emulation);
reset_button.addEventListener("click", reset_emulation);
step_frame_button.addEventListener("click", step_frame);
step_instruction_button.addEventListener("click", step_instruction);

audio_toggle.addEventListener("change", () => {
    if (!audio_toggle.checked) {
        audio_output.stop();
        audio_filter.reset();
        return;
    }

    if (frame_scheduler.is_running()) {
        void resume_audio_output();
    }
});

document.addEventListener("keydown", (event) => {
    keyboard_input.key_down(event.key, is_editable_target(event.target), () => event.preventDefault());
});
document.addEventListener("keyup", (event) => keyboard_input.key_up(event.key));
window.addEventListener("blur", () => keyboard_input.release_all());
window.addEventListener("pagehide", () => {
    save_battery_ram();
});
window.addEventListener("resize", resize_canvas);

if ("ResizeObserver" in window) {
    const resize_observer = new ResizeObserver(resize_canvas);
    resize_observer.observe(screen_container);
}

resize_canvas();
update_controls();

async function load_selected_rom(): Promise<void> {
    const file = rom_file_input.files?.item(0);
    rom_file_input.value = "";

    if (file === null || file === undefined) {
        return;
    }

    if (file.size > MAX_ROM_IMAGE_BYTES) {
        set_runtime_status(
            `Could not read ROM: the file exceeds the ${MAX_ROM_IMAGE_BYTES}-byte size limit.`,
            true,
        );
        return;
    }

    try {
        await install_rom(new Uint8Array(await file.arrayBuffer()), file.name);
    } catch (error) {
        set_runtime_status(`Could not read ROM: ${format_error(error)}`, true);
    }
}

async function load_bundled_rom(path: string, name: string): Promise<void> {
    pause_emulation();

    try {
        const response = await fetch(path, { cache: "no-store" });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status} while loading ${name}.`);
        }

        const content_length = response.headers.get("content-length");

        if (content_length !== null && Number(content_length) > MAX_ROM_IMAGE_BYTES) {
            throw new RangeError(`The ROM image exceeds the ${MAX_ROM_IMAGE_BYTES}-byte size limit.`);
        }

        await install_rom(new Uint8Array(await response.arrayBuffer()), name);
    } catch (error) {
        set_runtime_status(`Could not load ${name}: ${format_error(error)}`, true);
    }
}

async function install_rom(rom_bytes: Uint8Array, name: string): Promise<void> {
    pause_emulation();
    keyboard_input.release_all();

    const result = NesConsole.create(rom_bytes);

    if (!result.ok) {
        const error = result.error.detail;
        set_runtime_status(`ROM rejected (${error.code}): ${error.message}`, true);
        return;
    }

    let rom_fingerprint: string | null = null;

    try {
        rom_fingerprint = await fingerprint_rom(rom_bytes);
    } catch {
        // Emulation can still run when Web Crypto is unavailable; only per-ROM persistence is disabled.
    }

    const next_console = result.value;
    const battery_snapshot = next_console.get_battery_ram_snapshot();
    const battery_snapshot_length =
        battery_snapshot.prg_nvram.byteLength + battery_snapshot.chr_nvram.byteLength;
    let persistence_warning: string | null = null;

    if (battery_snapshot_length > 0) {
        if (rom_fingerprint === null) {
            persistence_warning = "Battery RAM persistence is unavailable because ROM hashing failed.";
        } else if (!battery_ram_store.is_available()) {
            persistence_warning = "Battery RAM persistence is unavailable because browser storage is disabled.";
        } else {
            try {
                const saved_snapshot = battery_ram_store.load(
                    rom_fingerprint,
                    battery_snapshot.prg_nvram.byteLength,
                    battery_snapshot.chr_nvram.byteLength,
                );

                if (saved_snapshot !== null) {
                    next_console.load_battery_ram_snapshot(saved_snapshot);
                }
            } catch (error) {
                persistence_warning = `Battery RAM could not be restored: ${format_error(error)}.`;
            }
        }
    }

    nes_console = next_console;
    loaded_rom_name = name;
    loaded_rom_fingerprint = rom_fingerprint;
    audio_output.reset_schedule();
    const audio_sample_rate_hz = nes_console.get_audio_sample_rate_hz();
    audio_output.set_sample_rate(audio_sample_rate_hz);
    audio_filter.set_sample_rate(audio_sample_rate_hz);
    audio_output.stop();
    render_current_console_state();
    update_cartridge_status();
    update_controls();
    const warning_suffix = persistence_warning === null ? "" : ` ${persistence_warning}`;
    set_runtime_status(`Loaded ${name}. Press Run or step a frame.${warning_suffix}`, persistence_warning !== null);
}

async function start_emulation(): Promise<void> {
    if (nes_console === null || frame_scheduler.is_running()) {
        return;
    }

    if (audio_toggle.checked) {
        await resume_audio_output();
    }

    canvas.focus({ preventScroll: true });
    nes_console.resume();
    frame_scheduler.start();
    update_controls();
    set_runtime_status(`Running ${loaded_rom_name}.`);
}

async function resume_audio_output(): Promise<void> {
    try {
        await audio_output.resume();
    } catch (error) {
        set_runtime_status(`Audio output is unavailable: ${format_error(error)}`, true);
    }
}

function pause_emulation(): void {
    frame_scheduler.stop();

    if (nes_console !== null) {
        nes_console.pause();
    }

    audio_output.stop();
    audio_filter.reset();
    const battery_save_warning = save_battery_ram();
    update_controls();

    if (nes_console !== null) {
        const warning_suffix = battery_save_warning === null ? "" : ` ${battery_save_warning}`;
        set_runtime_status(`Paused ${loaded_rom_name}.${warning_suffix}`, battery_save_warning !== null);
    }
}

function reset_emulation(): void {
    pause_emulation();

    if (nes_console === null) {
        return;
    }

    keyboard_input.release_all();
    nes_console.reset();
    audio_output.reset_schedule();
    audio_output.stop();
    render_current_console_state();
    update_cartridge_status();
    update_controls();
    set_runtime_status(`Reset ${loaded_rom_name}.`);
}

function step_frame(): void {
    pause_emulation();

    if (nes_console === null) {
        return;
    }

    render_console_frame(nes_console.advance_frame());
    const battery_save_warning = save_battery_ram();
    const warning_suffix = battery_save_warning === null ? "" : ` ${battery_save_warning}`;
    set_runtime_status(`Advanced one frame in ${loaded_rom_name}.${warning_suffix}`, battery_save_warning !== null);
}

function step_instruction(): void {
    pause_emulation();

    if (nes_console === null) {
        return;
    }

    const result = nes_console.step();
    const audio_samples = nes_console.drain_audio_samples();

    if (audio_toggle.checked) {
        audio_output.enqueue(audio_filter.process(audio_samples));
    }

    render_current_console_state();
    update_cartridge_status();
    const battery_save_warning = save_battery_ram();
    const warning_suffix = battery_save_warning === null ? "" : ` ${battery_save_warning}`;
    set_runtime_status(
        `Stepped ${result.sequence_kind} sequence in ${result.cpu_cycles} CPU cycles.${warning_suffix}`,
        battery_save_warning !== null,
    );
}

function render_console_frame(frame: NesConsoleFrame): void {
    canvas_renderer.render(frame.framebuffer, frame.emphasis);
    frame_description.textContent = `Frame: ${frame.frame_number}`;
    frame_cycle_status.textContent = `${frame.cpu_cycles_elapsed} CPU cycles`;
    audio_status.textContent = `${frame.audio_samples.length}`;
    update_cpu_status();

    if (audio_toggle.checked) {
        audio_output.enqueue(audio_filter.process(frame.audio_samples));
    }
}

function render_current_console_state(): void {
    if (nes_console === null) {
        return;
    }

    canvas_renderer.render(nes_console.get_framebuffer(), nes_console.get_framebuffer_emphasis());
    frame_description.textContent = `Frame: ${nes_console.get_frame_number()}`;
    frame_cycle_status.textContent = "-";
    audio_status.textContent = "0";
    update_cpu_status();
}

function update_cartridge_status(): void {
    if (nes_console === null) {
        rom_description.textContent = "No ROM loaded";
        mapper_status.textContent = "-";
        cycle_status.textContent = "0";
        pc_status.textContent = "-";
        return;
    }

    const metadata = nes_console.get_rom_metadata();
    rom_description.textContent = loaded_rom_name;
    mapper_status.textContent = `${metadata.mapper_id}/${metadata.submapper} (${metadata.mirroring})`;
    update_cpu_status();
}

function update_cpu_status(): void {
    if (nes_console === null) {
        return;
    }

    const cpu_state = nes_console.get_cpu_state();
    cycle_status.textContent = `${nes_console.get_cpu_cycle_count()}`;
    pc_status.textContent = `0x${cpu_state.program_counter.toString(16).padStart(4, "0").toUpperCase()}`;
}

function update_controls(): void {
    const rom_is_loaded = nes_console !== null;
    const is_running = frame_scheduler.is_running();

    run_button.disabled = !rom_is_loaded || is_running;
    pause_button.disabled = !rom_is_loaded || !is_running;
    reset_button.disabled = !rom_is_loaded;
    step_frame_button.disabled = !rom_is_loaded || is_running;
    step_instruction_button.disabled = !rom_is_loaded || is_running;
}

function save_battery_ram(): string | null {
    if (nes_console === null) {
        return null;
    }

    const snapshot = nes_console.get_battery_ram_snapshot();

    if (snapshot.prg_nvram.byteLength + snapshot.chr_nvram.byteLength === 0) {
        return null;
    }

    if (loaded_rom_fingerprint === null) {
        return "Battery RAM was not saved because this ROM has no available SHA-256 fingerprint.";
    }

    if (!battery_ram_store.is_available()) {
        return "Battery RAM was not saved because browser storage is disabled.";
    }

    try {
        battery_ram_store.save(loaded_rom_fingerprint, snapshot);
        return null;
    } catch (error) {
        return `Battery RAM save failed: ${format_error(error)}.`;
    }
}

function get_browser_storage(): BrowserKeyValueStorage | null {
    try {
        return window.localStorage;
    } catch {
        return null;
    }
}

function is_editable_target(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) {
        return false;
    }

    return target.matches("input, select, textarea") || target.isContentEditable;
}

function resize_canvas(): void {
    const available_width = Math.max(1, screen_container.clientWidth - 24);
    const available_height = Math.max(1, screen_container.clientHeight - 24);

    try {
        canvas_renderer.fit_to_size(available_width, available_height);
    } catch {
        // The container can briefly report zero size during initial page layout.
    }
}

function get_required_element<ElementType extends HTMLElement>(id: string): ElementType {
    const element = document.getElementById(id);

    if (element === null) {
        throw new Error(`Missing required browser element #${id}.`);
    }

    return element as ElementType;
}

function set_runtime_status(message: string, is_error = false): void {
    runtime_status.textContent = message;
    runtime_status.dataset.state = is_error ? "error" : "ready";
}

function format_error(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
