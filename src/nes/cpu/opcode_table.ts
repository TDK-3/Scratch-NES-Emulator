import type { CpuAddressingMode, CpuOperandAccess } from "./addressing_modes.js";

export type CpuInstructionMnemonic =
    | "ADC"
    | "AHX"
    | "ALR"
    | "ANC"
    | "AND"
    | "ARR"
    | "ASL"
    | "AXS"
    | "BCC"
    | "BCS"
    | "BEQ"
    | "BIT"
    | "BMI"
    | "BNE"
    | "BPL"
    | "BRK"
    | "BVC"
    | "BVS"
    | "CLC"
    | "CLD"
    | "CLI"
    | "CLV"
    | "CMP"
    | "CPX"
    | "CPY"
    | "DCP"
    | "DEC"
    | "DEX"
    | "DEY"
    | "EOR"
    | "INC"
    | "ISC"
    | "INX"
    | "INY"
    | "JMP"
    | "JSR"
    | "KIL"
    | "LDA"
    | "LAS"
    | "LAX"
    | "LXA"
    | "LDX"
    | "LDY"
    | "LSR"
    | "NOP"
    | "ORA"
    | "PHA"
    | "PHP"
    | "PLA"
    | "PLP"
    | "RLA"
    | "ROL"
    | "ROR"
    | "RRA"
    | "RTI"
    | "RTS"
    | "SAX"
    | "SBC"
    | "SEC"
    | "SED"
    | "SEI"
    | "SHX"
    | "SHY"
    | "SLO"
    | "SRE"
    | "STA"
    | "STX"
    | "STY"
    | "TAS"
    | "TAX"
    | "TAY"
    | "TSX"
    | "TXA"
    | "TXS"
    | "TYA"
    | "XAA";

export interface OpcodeDefinition {
    readonly opcode: number;
    readonly mnemonic: CpuInstructionMnemonic;
    readonly addressing_mode: CpuAddressingMode;
    readonly base_cycles: number;
    readonly operand_access: CpuOperandAccess;
    readonly page_cross_cycle: boolean;
}

type OpcodeSpecification = readonly [
    opcode: number,
    mnemonic: CpuInstructionMnemonic,
    addressing_mode: CpuAddressingMode,
    base_cycles: number,
    operand_access: CpuOperandAccess,
];

const OPCODE_SPECIFICATIONS: readonly OpcodeSpecification[] = [
    [0x00, "BRK", "implied", 7, "read"],
    [0x01, "ORA", "indexed_indirect", 6, "read"],
    [0x05, "ORA", "zero_page", 3, "read"],
    [0x06, "ASL", "zero_page", 5, "read_modify_write"],
    [0x08, "PHP", "implied", 3, "read"],
    [0x09, "ORA", "immediate", 2, "read"],
    [0x0a, "ASL", "accumulator", 2, "read_modify_write"],
    [0x0d, "ORA", "absolute", 4, "read"],
    [0x0e, "ASL", "absolute", 6, "read_modify_write"],
    [0x10, "BPL", "relative", 2, "read"],
    [0x11, "ORA", "indirect_indexed", 5, "read"],
    [0x15, "ORA", "zero_page_x", 4, "read"],
    [0x16, "ASL", "zero_page_x", 6, "read_modify_write"],
    [0x18, "CLC", "implied", 2, "read"],
    [0x19, "ORA", "absolute_y", 4, "read"],
    [0x1d, "ORA", "absolute_x", 4, "read"],
    [0x1e, "ASL", "absolute_x", 7, "read_modify_write"],
    [0x20, "JSR", "absolute", 6, "read"],
    [0x21, "AND", "indexed_indirect", 6, "read"],
    [0x24, "BIT", "zero_page", 3, "read"],
    [0x25, "AND", "zero_page", 3, "read"],
    [0x26, "ROL", "zero_page", 5, "read_modify_write"],
    [0x28, "PLP", "implied", 4, "read"],
    [0x29, "AND", "immediate", 2, "read"],
    [0x2a, "ROL", "accumulator", 2, "read_modify_write"],
    [0x2c, "BIT", "absolute", 4, "read"],
    [0x2d, "AND", "absolute", 4, "read"],
    [0x2e, "ROL", "absolute", 6, "read_modify_write"],
    [0x30, "BMI", "relative", 2, "read"],
    [0x31, "AND", "indirect_indexed", 5, "read"],
    [0x35, "AND", "zero_page_x", 4, "read"],
    [0x36, "ROL", "zero_page_x", 6, "read_modify_write"],
    [0x38, "SEC", "implied", 2, "read"],
    [0x39, "AND", "absolute_y", 4, "read"],
    [0x3d, "AND", "absolute_x", 4, "read"],
    [0x3e, "ROL", "absolute_x", 7, "read_modify_write"],
    [0x40, "RTI", "implied", 6, "read"],
    [0x41, "EOR", "indexed_indirect", 6, "read"],
    [0x45, "EOR", "zero_page", 3, "read"],
    [0x46, "LSR", "zero_page", 5, "read_modify_write"],
    [0x48, "PHA", "implied", 3, "read"],
    [0x49, "EOR", "immediate", 2, "read"],
    [0x4a, "LSR", "accumulator", 2, "read_modify_write"],
    [0x4c, "JMP", "absolute", 3, "read"],
    [0x4d, "EOR", "absolute", 4, "read"],
    [0x4e, "LSR", "absolute", 6, "read_modify_write"],
    [0x50, "BVC", "relative", 2, "read"],
    [0x51, "EOR", "indirect_indexed", 5, "read"],
    [0x55, "EOR", "zero_page_x", 4, "read"],
    [0x56, "LSR", "zero_page_x", 6, "read_modify_write"],
    [0x58, "CLI", "implied", 2, "read"],
    [0x59, "EOR", "absolute_y", 4, "read"],
    [0x5d, "EOR", "absolute_x", 4, "read"],
    [0x5e, "LSR", "absolute_x", 7, "read_modify_write"],
    [0x60, "RTS", "implied", 6, "read"],
    [0x61, "ADC", "indexed_indirect", 6, "read"],
    [0x65, "ADC", "zero_page", 3, "read"],
    [0x66, "ROR", "zero_page", 5, "read_modify_write"],
    [0x68, "PLA", "implied", 4, "read"],
    [0x69, "ADC", "immediate", 2, "read"],
    [0x6a, "ROR", "accumulator", 2, "read_modify_write"],
    [0x6c, "JMP", "indirect", 5, "read"],
    [0x6d, "ADC", "absolute", 4, "read"],
    [0x6e, "ROR", "absolute", 6, "read_modify_write"],
    [0x70, "BVS", "relative", 2, "read"],
    [0x71, "ADC", "indirect_indexed", 5, "read"],
    [0x75, "ADC", "zero_page_x", 4, "read"],
    [0x76, "ROR", "zero_page_x", 6, "read_modify_write"],
    [0x78, "SEI", "implied", 2, "read"],
    [0x79, "ADC", "absolute_y", 4, "read"],
    [0x7d, "ADC", "absolute_x", 4, "read"],
    [0x7e, "ROR", "absolute_x", 7, "read_modify_write"],
    [0x81, "STA", "indexed_indirect", 6, "write"],
    [0x84, "STY", "zero_page", 3, "write"],
    [0x85, "STA", "zero_page", 3, "write"],
    [0x86, "STX", "zero_page", 3, "write"],
    [0x88, "DEY", "implied", 2, "read"],
    [0x8a, "TXA", "implied", 2, "read"],
    [0x8c, "STY", "absolute", 4, "write"],
    [0x8d, "STA", "absolute", 4, "write"],
    [0x8e, "STX", "absolute", 4, "write"],
    [0x90, "BCC", "relative", 2, "read"],
    [0x91, "STA", "indirect_indexed", 6, "write"],
    [0x94, "STY", "zero_page_x", 4, "write"],
    [0x95, "STA", "zero_page_x", 4, "write"],
    [0x96, "STX", "zero_page_y", 4, "write"],
    [0x98, "TYA", "implied", 2, "read"],
    [0x99, "STA", "absolute_y", 5, "write"],
    [0x9a, "TXS", "implied", 2, "read"],
    [0x9d, "STA", "absolute_x", 5, "write"],
    [0xa0, "LDY", "immediate", 2, "read"],
    [0xa1, "LDA", "indexed_indirect", 6, "read"],
    [0xa2, "LDX", "immediate", 2, "read"],
    [0xa4, "LDY", "zero_page", 3, "read"],
    [0xa5, "LDA", "zero_page", 3, "read"],
    [0xa6, "LDX", "zero_page", 3, "read"],
    [0xa8, "TAY", "implied", 2, "read"],
    [0xa9, "LDA", "immediate", 2, "read"],
    [0xaa, "TAX", "implied", 2, "read"],
    [0xac, "LDY", "absolute", 4, "read"],
    [0xad, "LDA", "absolute", 4, "read"],
    [0xae, "LDX", "absolute", 4, "read"],
    [0xb0, "BCS", "relative", 2, "read"],
    [0xb1, "LDA", "indirect_indexed", 5, "read"],
    [0xb4, "LDY", "zero_page_x", 4, "read"],
    [0xb5, "LDA", "zero_page_x", 4, "read"],
    [0xb6, "LDX", "zero_page_y", 4, "read"],
    [0xb8, "CLV", "implied", 2, "read"],
    [0xb9, "LDA", "absolute_y", 4, "read"],
    [0xba, "TSX", "implied", 2, "read"],
    [0xbc, "LDY", "absolute_x", 4, "read"],
    [0xbd, "LDA", "absolute_x", 4, "read"],
    [0xbe, "LDX", "absolute_y", 4, "read"],
    [0xc0, "CPY", "immediate", 2, "read"],
    [0xc1, "CMP", "indexed_indirect", 6, "read"],
    [0xc4, "CPY", "zero_page", 3, "read"],
    [0xc5, "CMP", "zero_page", 3, "read"],
    [0xc6, "DEC", "zero_page", 5, "read_modify_write"],
    [0xc8, "INY", "implied", 2, "read"],
    [0xc9, "CMP", "immediate", 2, "read"],
    [0xca, "DEX", "implied", 2, "read"],
    [0xcc, "CPY", "absolute", 4, "read"],
    [0xcd, "CMP", "absolute", 4, "read"],
    [0xce, "DEC", "absolute", 6, "read_modify_write"],
    [0xd0, "BNE", "relative", 2, "read"],
    [0xd1, "CMP", "indirect_indexed", 5, "read"],
    [0xd5, "CMP", "zero_page_x", 4, "read"],
    [0xd6, "DEC", "zero_page_x", 6, "read_modify_write"],
    [0xd8, "CLD", "implied", 2, "read"],
    [0xd9, "CMP", "absolute_y", 4, "read"],
    [0xdd, "CMP", "absolute_x", 4, "read"],
    [0xde, "DEC", "absolute_x", 7, "read_modify_write"],
    [0xe0, "CPX", "immediate", 2, "read"],
    [0xe1, "SBC", "indexed_indirect", 6, "read"],
    [0xe4, "CPX", "zero_page", 3, "read"],
    [0xe5, "SBC", "zero_page", 3, "read"],
    [0xe6, "INC", "zero_page", 5, "read_modify_write"],
    [0xe8, "INX", "implied", 2, "read"],
    [0xe9, "SBC", "immediate", 2, "read"],
    [0xea, "NOP", "implied", 2, "read"],
    [0xec, "CPX", "absolute", 4, "read"],
    [0xed, "SBC", "absolute", 4, "read"],
    [0xee, "INC", "absolute", 6, "read_modify_write"],
    [0xf0, "BEQ", "relative", 2, "read"],
    [0xf1, "SBC", "indirect_indexed", 5, "read"],
    [0xf5, "SBC", "zero_page_x", 4, "read"],
    [0xf6, "INC", "zero_page_x", 6, "read_modify_write"],
    [0xf8, "SED", "implied", 2, "read"],
    [0xf9, "SBC", "absolute_y", 4, "read"],
    [0xfd, "SBC", "absolute_x", 4, "read"],
    [0xfe, "INC", "absolute_x", 7, "read_modify_write"],
];

const UNOFFICIAL_ALU_SPECIFICATIONS: readonly OpcodeSpecification[] = [
    [0x0b, "ANC", "immediate", 2, "read"],
    [0x2b, "ANC", "immediate", 2, "read"],
    [0x4b, "ALR", "immediate", 2, "read"],
    [0x6b, "ARR", "immediate", 2, "read"],
    [0xcb, "AXS", "immediate", 2, "read"],
    [0xeb, "SBC", "immediate", 2, "read"],
];

const UNOFFICIAL_UNSTABLE_IMMEDIATE_SPECIFICATIONS: readonly OpcodeSpecification[] = [
    [0x8b, "XAA", "immediate", 2, "read"],
    [0xab, "LXA", "immediate", 2, "read"],
];

const UNOFFICIAL_LOAD_STORE_SPECIFICATIONS: readonly OpcodeSpecification[] = [
    [0x83, "SAX", "indexed_indirect", 6, "write"],
    [0x87, "SAX", "zero_page", 3, "write"],
    [0x8f, "SAX", "absolute", 4, "write"],
    [0x97, "SAX", "zero_page_y", 4, "write"],
    [0xa3, "LAX", "indexed_indirect", 6, "read"],
    [0xa7, "LAX", "zero_page", 3, "read"],
    [0xaf, "LAX", "absolute", 4, "read"],
    [0xb3, "LAX", "indirect_indexed", 5, "read"],
    [0xb7, "LAX", "zero_page_y", 4, "read"],
    [0xbb, "LAS", "absolute_y", 4, "read"],
    [0xbf, "LAX", "absolute_y", 4, "read"],
];

const UNOFFICIAL_UNSTABLE_STORE_SPECIFICATIONS: readonly OpcodeSpecification[] = [
    [0x93, "AHX", "indirect_indexed", 6, "write"],
    [0x9b, "TAS", "absolute_y", 5, "write"],
    [0x9c, "SHY", "absolute_x", 5, "write"],
    [0x9e, "SHX", "absolute_y", 5, "write"],
    [0x9f, "AHX", "absolute_y", 5, "write"],
];

const UNOFFICIAL_RMW_SPECIFICATIONS: readonly OpcodeSpecification[] = [
    [0x03, "SLO", "indexed_indirect", 8, "read_modify_write"],
    [0x07, "SLO", "zero_page", 5, "read_modify_write"],
    [0x0f, "SLO", "absolute", 6, "read_modify_write"],
    [0x13, "SLO", "indirect_indexed", 8, "read_modify_write"],
    [0x17, "SLO", "zero_page_x", 6, "read_modify_write"],
    [0x1b, "SLO", "absolute_y", 7, "read_modify_write"],
    [0x1f, "SLO", "absolute_x", 7, "read_modify_write"],
    [0x23, "RLA", "indexed_indirect", 8, "read_modify_write"],
    [0x27, "RLA", "zero_page", 5, "read_modify_write"],
    [0x2f, "RLA", "absolute", 6, "read_modify_write"],
    [0x33, "RLA", "indirect_indexed", 8, "read_modify_write"],
    [0x37, "RLA", "zero_page_x", 6, "read_modify_write"],
    [0x3b, "RLA", "absolute_y", 7, "read_modify_write"],
    [0x3f, "RLA", "absolute_x", 7, "read_modify_write"],
    [0x43, "SRE", "indexed_indirect", 8, "read_modify_write"],
    [0x47, "SRE", "zero_page", 5, "read_modify_write"],
    [0x4f, "SRE", "absolute", 6, "read_modify_write"],
    [0x53, "SRE", "indirect_indexed", 8, "read_modify_write"],
    [0x57, "SRE", "zero_page_x", 6, "read_modify_write"],
    [0x5b, "SRE", "absolute_y", 7, "read_modify_write"],
    [0x5f, "SRE", "absolute_x", 7, "read_modify_write"],
    [0x63, "RRA", "indexed_indirect", 8, "read_modify_write"],
    [0x67, "RRA", "zero_page", 5, "read_modify_write"],
    [0x6f, "RRA", "absolute", 6, "read_modify_write"],
    [0x73, "RRA", "indirect_indexed", 8, "read_modify_write"],
    [0x77, "RRA", "zero_page_x", 6, "read_modify_write"],
    [0x7b, "RRA", "absolute_y", 7, "read_modify_write"],
    [0x7f, "RRA", "absolute_x", 7, "read_modify_write"],
    [0xc3, "DCP", "indexed_indirect", 8, "read_modify_write"],
    [0xc7, "DCP", "zero_page", 5, "read_modify_write"],
    [0xcf, "DCP", "absolute", 6, "read_modify_write"],
    [0xd3, "DCP", "indirect_indexed", 8, "read_modify_write"],
    [0xd7, "DCP", "zero_page_x", 6, "read_modify_write"],
    [0xdb, "DCP", "absolute_y", 7, "read_modify_write"],
    [0xdf, "DCP", "absolute_x", 7, "read_modify_write"],
    [0xe3, "ISC", "indexed_indirect", 8, "read_modify_write"],
    [0xe7, "ISC", "zero_page", 5, "read_modify_write"],
    [0xef, "ISC", "absolute", 6, "read_modify_write"],
    [0xf3, "ISC", "indirect_indexed", 8, "read_modify_write"],
    [0xf7, "ISC", "zero_page_x", 6, "read_modify_write"],
    [0xfb, "ISC", "absolute_y", 7, "read_modify_write"],
    [0xff, "ISC", "absolute_x", 7, "read_modify_write"],
];

const UNOFFICIAL_KIL_SPECIFICATIONS: readonly OpcodeSpecification[] = [
    [0x02, "KIL", "implied", 2, "read"],
    [0x12, "KIL", "implied", 2, "read"],
    [0x22, "KIL", "implied", 2, "read"],
    [0x32, "KIL", "implied", 2, "read"],
    [0x42, "KIL", "implied", 2, "read"],
    [0x52, "KIL", "implied", 2, "read"],
    [0x62, "KIL", "implied", 2, "read"],
    [0x72, "KIL", "implied", 2, "read"],
    [0x92, "KIL", "implied", 2, "read"],
    [0xb2, "KIL", "implied", 2, "read"],
    [0xd2, "KIL", "implied", 2, "read"],
    [0xf2, "KIL", "implied", 2, "read"],
];

const UNOFFICIAL_NOP_SPECIFICATIONS: readonly OpcodeSpecification[] = [
    [0x04, "NOP", "zero_page", 3, "read"],
    [0x0c, "NOP", "absolute", 4, "read"],
    [0x14, "NOP", "zero_page_x", 4, "read"],
    [0x1a, "NOP", "implied", 2, "read"],
    [0x1c, "NOP", "absolute_x", 4, "read"],
    [0x34, "NOP", "zero_page_x", 4, "read"],
    [0x3a, "NOP", "implied", 2, "read"],
    [0x3c, "NOP", "absolute_x", 4, "read"],
    [0x44, "NOP", "zero_page", 3, "read"],
    [0x54, "NOP", "zero_page_x", 4, "read"],
    [0x5a, "NOP", "implied", 2, "read"],
    [0x5c, "NOP", "absolute_x", 4, "read"],
    [0x64, "NOP", "zero_page", 3, "read"],
    [0x74, "NOP", "zero_page_x", 4, "read"],
    [0x7a, "NOP", "implied", 2, "read"],
    [0x7c, "NOP", "absolute_x", 4, "read"],
    [0x80, "NOP", "immediate", 2, "read"],
    [0x82, "NOP", "immediate", 2, "read"],
    [0x89, "NOP", "immediate", 2, "read"],
    [0xc2, "NOP", "immediate", 2, "read"],
    [0xd4, "NOP", "zero_page_x", 4, "read"],
    [0xda, "NOP", "implied", 2, "read"],
    [0xdc, "NOP", "absolute_x", 4, "read"],
    [0xe2, "NOP", "immediate", 2, "read"],
    [0xf4, "NOP", "zero_page_x", 4, "read"],
    [0xfa, "NOP", "implied", 2, "read"],
    [0xfc, "NOP", "absolute_x", 4, "read"],
];

function create_opcode_definition(specification: OpcodeSpecification): OpcodeDefinition {
    const [opcode, mnemonic, addressing_mode, base_cycles, operand_access] = specification;

    return {
        opcode,
        mnemonic,
        addressing_mode,
        base_cycles,
        operand_access,
        page_cross_cycle:
            operand_access === "read" &&
            (addressing_mode === "absolute_x" ||
                addressing_mode === "absolute_y" ||
                addressing_mode === "indirect_indexed"),
    };
}

export const OFFICIAL_OPCODE_DEFINITIONS: readonly OpcodeDefinition[] = OPCODE_SPECIFICATIONS.map(
    create_opcode_definition,
);
/** All 105 unofficial instruction encodings; unstable behavior is modeled with documented approximations. */
export const UNOFFICIAL_OPCODE_DEFINITIONS: readonly OpcodeDefinition[] = [
    ...UNOFFICIAL_NOP_SPECIFICATIONS,
    ...UNOFFICIAL_ALU_SPECIFICATIONS,
    ...UNOFFICIAL_UNSTABLE_IMMEDIATE_SPECIFICATIONS,
    ...UNOFFICIAL_LOAD_STORE_SPECIFICATIONS,
    ...UNOFFICIAL_UNSTABLE_STORE_SPECIFICATIONS,
    ...UNOFFICIAL_RMW_SPECIFICATIONS,
    ...UNOFFICIAL_KIL_SPECIFICATIONS,
].map(create_opcode_definition);

const opcode_table = new Map<number, OpcodeDefinition>();

for (const definition of OFFICIAL_OPCODE_DEFINITIONS) {
    opcode_table.set(definition.opcode, definition);
}

for (const definition of UNOFFICIAL_OPCODE_DEFINITIONS) {
    if (opcode_table.has(definition.opcode)) {
        throw new Error(`Opcode $${definition.opcode.toString(16)} is defined more than once.`);
    }

    opcode_table.set(definition.opcode, definition);
}

export const CPU_OPCODE_TABLE: ReadonlyMap<number, OpcodeDefinition> = opcode_table;
