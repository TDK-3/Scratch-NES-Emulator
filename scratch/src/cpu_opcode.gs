# Opcode decode for the GoboScript port.
#
# The table is reference data, not ported logic. tests/fixtures/goboscript/opcode_table.json is
# the canonical integer encoding of src/nes/cpu/opcode_table.ts, kept equal to it by
# tests/goboscript-opcode-table.test.ts, and scripts/generate_goboscript_opcode_table.mjs
# flattens it into data/opcode_table.txt, which `npm run scratch:opcode` regenerates before a
# build. The mnemonic ids below come from that fixture; the addressing mode and operand access
# ids are the ones src/cpu_addressing.gs already uses, so a decoded instruction can be handed
# to cpu_resolve_operand without translation. Dispatch, flag updates, and cycle accounting stay
# hand-written in the port.
#
# The generated list holds the schema version and the opcode count, then six values per opcode
# in opcode order: mnemonic id, addressing mode id, base cycles, operand access id, the
# page-cross cycle flag, and the official flag. Lists are 1-based here, so the record for one
# opcode starts at 3 + opcode * 6.

%include src/numeric

# Mnemonic ids from the canonical opcode table fixture, covering the 151 official encodings and
# the 105 unofficial ones. Every variant carries an `op_` prefix, because a bare `and` is a
# GoboScript operator keyword rather than a name.
enum cpu_mnemonic {
    op_adc = 1,
    op_ahx = 2,
    op_alr = 3,
    op_anc = 4,
    op_and = 5,
    op_arr = 6,
    op_asl = 7,
    op_axs = 8,
    op_bcc = 9,
    op_bcs = 10,
    op_beq = 11,
    op_bit = 12,
    op_bmi = 13,
    op_bne = 14,
    op_bpl = 15,
    op_brk = 16,
    op_bvc = 17,
    op_bvs = 18,
    op_clc = 19,
    op_cld = 20,
    op_cli = 21,
    op_clv = 22,
    op_cmp = 23,
    op_cpx = 24,
    op_cpy = 25,
    op_dcp = 26,
    op_dec = 27,
    op_dex = 28,
    op_dey = 29,
    op_eor = 30,
    op_inc = 31,
    op_inx = 32,
    op_iny = 33,
    op_isc = 34,
    op_jmp = 35,
    op_jsr = 36,
    op_kil = 37,
    op_las = 38,
    op_lax = 39,
    op_lda = 40,
    op_ldx = 41,
    op_ldy = 42,
    op_lsr = 43,
    op_lxa = 44,
    op_nop = 45,
    op_ora = 46,
    op_pha = 47,
    op_php = 48,
    op_pla = 49,
    op_plp = 50,
    op_rla = 51,
    op_rol = 52,
    op_ror = 53,
    op_rra = 54,
    op_rti = 55,
    op_rts = 56,
    op_sax = 57,
    op_sbc = 58,
    op_sec = 59,
    op_sed = 60,
    op_sei = 61,
    op_shx = 62,
    op_shy = 63,
    op_slo = 64,
    op_sre = 65,
    op_sta = 66,
    op_stx = 67,
    op_sty = 68,
    op_tas = 69,
    op_tax = 70,
    op_tay = 71,
    op_tsx = 72,
    op_txa = 73,
    op_txs = 74,
    op_tya = 75,
    op_xaa = 76
}

# Field positions inside one opcode's six-value record.
enum cpu_opcode_field {
    mnemonic = 0,
    addressing_mode = 1,
    base_cycles = 2,
    operand_access = 3,
    page_cross_cycle = 4,
    official = 5
}

# Shape of the generated list: two header values, six values per opcode, 256 opcodes.
enum cpu_opcode_layout {
    header_values = 2,
    fields_per_opcode = 6,
    opcode_count = 256,
    schema_version = 1
}

enum cpu_opcode_error_code {
    none = 0,
    unknown_opcode = 1,
    bad_table = 2
}

var cpu_opcode_mnemonic = 0;
var cpu_opcode_mode = 0;
var cpu_opcode_base_cycles = 0;
var cpu_opcode_access = 0;
var cpu_opcode_page_cross_cycle = 0;
var cpu_opcode_official = 0;
var cpu_opcode_error = 0;

list cpu_opcode_table "data/opcode_table.txt";

# Clears the decoded fields without reading the table.
proc cpu_reset_opcode_decode {
    cpu_opcode_mnemonic = 0;
    cpu_opcode_mode = 0;
    cpu_opcode_base_cycles = 0;
    cpu_opcode_access = 0;
    cpu_opcode_page_cross_cycle = 0;
    cpu_opcode_official = 0;
    cpu_opcode_error = cpu_opcode_error_code.none;
}

# Checks the generated list's length and header, so a missing, stale, or truncated data file is
# reported instead of decoded as zeros. The self test runs this before it replays any decode
# vector.
proc cpu_check_opcode_table {
    local expected_length = cpu_opcode_layout.header_values;
    expected_length = expected_length + (cpu_opcode_layout.opcode_count * cpu_opcode_layout.fields_per_opcode);
    cpu_opcode_error = cpu_opcode_error_code.none;

    if (length cpu_opcode_table) != expected_length {
        cpu_opcode_error = cpu_opcode_error_code.bad_table;
    } elif to_number(cpu_opcode_table[1]) != cpu_opcode_layout.schema_version {
        cpu_opcode_error = cpu_opcode_error_code.bad_table;
    } elif to_number(cpu_opcode_table[2]) != cpu_opcode_layout.opcode_count {
        cpu_opcode_error = cpu_opcode_error_code.bad_table;
    }
}

# Decodes one opcode byte into the cpu_opcode_* globals. Every byte from 0 through 255 is
# defined by the reference table, so a zero mnemonic id means the generated list did not load
# or is out of date rather than that the opcode is unknown; the error code records that.
proc cpu_decode_opcode opcode {
    local numeric_opcode = $opcode % 256;
    local record_start = (cpu_opcode_layout.header_values + 1)
        + (numeric_opcode * cpu_opcode_layout.fields_per_opcode);

    # cpu_reset_opcode_decode() inlined, and each field coerces its list item with the same
    # numeric add to_number performs instead of a custom-block call: this runs once per
    # emulated instruction, and the seven calls it used to make were most of what it cost.
    cpu_opcode_mnemonic = 0;
    cpu_opcode_mode = 0;
    cpu_opcode_base_cycles = 0;
    cpu_opcode_access = 0;
    cpu_opcode_page_cross_cycle = 0;
    cpu_opcode_official = 0;
    cpu_opcode_error = cpu_opcode_error_code.none;
    cpu_opcode_mnemonic = cpu_opcode_table[record_start + cpu_opcode_field.mnemonic] + "";
    cpu_opcode_mode = cpu_opcode_table[record_start + cpu_opcode_field.addressing_mode] + "";
    cpu_opcode_base_cycles = cpu_opcode_table[record_start + cpu_opcode_field.base_cycles] + "";
    cpu_opcode_access = cpu_opcode_table[record_start + cpu_opcode_field.operand_access] + "";
    cpu_opcode_page_cross_cycle = cpu_opcode_table[record_start + cpu_opcode_field.page_cross_cycle] + "";
    cpu_opcode_official = cpu_opcode_table[record_start + cpu_opcode_field.official] + "";

    if cpu_opcode_mnemonic == 0 {
        cpu_opcode_error = cpu_opcode_error_code.unknown_opcode;
    }
}
