/** The 13 official 2A03 addressing modes. */
export type CpuAddressingMode =
    | "implied"
    | "accumulator"
    | "immediate"
    | "relative"
    | "zero_page"
    | "zero_page_x"
    | "zero_page_y"
    | "absolute"
    | "absolute_x"
    | "absolute_y"
    | "indirect"
    | "indexed_indirect"
    | "indirect_indexed";

export type CpuOperandAccess = "read" | "write" | "read_modify_write";

export type MemoryAddressingMode =
    | "zero_page"
    | "zero_page_x"
    | "zero_page_y"
    | "absolute"
    | "absolute_x"
    | "absolute_y"
    | "indexed_indirect"
    | "indirect_indexed";

/** A decoded operand/address; addressing-time bus reads have already occurred. */
export type ResolvedCpuOperand =
    | { readonly kind: "implied"; readonly mode: "implied" }
    | {
          readonly kind: "accumulator";
          readonly mode: "accumulator";
          readonly access: "read" | "read_modify_write";
      }
    | { readonly kind: "immediate"; readonly mode: "immediate"; readonly value: number }
    | {
          readonly kind: "relative";
          readonly mode: "relative";
          readonly offset: number;
          readonly origin_address: number;
          readonly target_address: number;
          readonly page_crossed: boolean;
      }
    | {
          readonly kind: "memory";
          readonly mode: MemoryAddressingMode;
          readonly access: CpuOperandAccess;
          readonly base_address: number;
          readonly address: number;
          readonly page_crossed: boolean;
      }
    | {
          readonly kind: "jump_target";
          readonly mode: "indirect";
          readonly address: number;
          readonly pointer_address: number;
      };
