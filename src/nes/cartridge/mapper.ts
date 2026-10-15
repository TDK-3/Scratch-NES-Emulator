import type { InesRom } from "./ines.js";

/**
 * Exact mapper/submapper pairs admitted by cartridge selection. A route identifies the board family;
 * its presence alone does not claim that the mapper implementation is complete.
 */
const SUPPORTED_MAPPER_ROUTES = [
    { mapper_id: 0, submapper: 0, kind: "nrom" },
    { mapper_id: 4, submapper: 0, kind: "mmc3" },
] as const;

export type SupportedMapperRoute = (typeof SUPPORTED_MAPPER_ROUTES)[number];
export type MapperSelectionErrorCode = "unsupported-mapper" | "unsupported-submapper";

export interface MapperSelectionError {
    readonly code: MapperSelectionErrorCode;
    readonly mapper_id: number;
    readonly submapper: number;
    readonly message: string;
}

export type MapperSelectionResult =
    | { readonly ok: true; readonly value: SupportedMapperRoute }
    | { readonly ok: false; readonly error: MapperSelectionError };

/** Selects an exact registered route or reports the unsupported board; never defaults to NROM. */
export function resolve_mapper(rom: Pick<InesRom, "mapper_id" | "submapper">): MapperSelectionResult {
    const route = SUPPORTED_MAPPER_ROUTES.find(
        (candidate) => candidate.mapper_id === rom.mapper_id && candidate.submapper === rom.submapper,
    );

    if (route !== undefined) {
        return { ok: true, value: { ...route } };
    }

    const mapper_is_known = SUPPORTED_MAPPER_ROUTES.some(
        (candidate) => candidate.mapper_id === rom.mapper_id,
    );
    const code: MapperSelectionErrorCode = mapper_is_known
        ? "unsupported-submapper"
        : "unsupported-mapper";

    return {
        ok: false,
        error: {
            code,
            mapper_id: rom.mapper_id,
            submapper: rom.submapper,
            message: `Mapper ${rom.mapper_id} submapper ${rom.submapper} is not supported.`,
        },
    };
}
