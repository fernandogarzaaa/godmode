import type { Point, Viewport, VisibleElement } from "../core/types.js";
import type { AdapterOptions, BrowserAdapter, RawSnapshot } from "./adapter.js";
/** One element of a Rune `--tree` dump (subset this driver reads). */
export interface RuneTreeElement {
    path?: string;
    role?: string;
    rect: [number, number, number, number];
    key?: string;
    label?: string;
    text?: string;
    color?: string;
    fill?: string;
    focusable?: boolean;
    focused?: boolean;
    opacity?: number;
    inert?: boolean;
}
/** A Rune `--tree` dump (subset this driver reads). */
export interface RuneTree {
    title?: string;
    viewport: [number, number];
    scale?: number;
    t?: number;
    elements: RuneTreeElement[];
}
/** One scripted input event, as Rune's `--script` JSON expects. */
export type RuneScriptEvent = Record<string, unknown>;
export interface RuneAdapterOptions extends AdapterOptions {
    /**
     * Directory receiving one PNG + tree JSON + journal snapshot per step,
     * for post-run grounding scoring. Unset disables recording.
     */
    recordDir?: string;
    /** Virtual seconds allowed for springs to settle after an action. */
    settleSeconds?: number;
}
/**
 * Map a Rune tree dump to the elements a human perceives.
 *
 * Retina abstraction, same contract as the Playwright perception script:
 * only what is actually rendered and visible is reported. An element is
 * perceivable when it carries rendered text or is an interactive affordance
 * (focusable). Everything else is excluded: the window background group, a
 * switch's knob sub-part, hidden (`opacity: 0`) or inert elements, and
 * off-viewport content. Internal identifiers (`key`, `path`) and the
 * accessibility tree's internal states are never copied through; the only
 * text that may come from a non-visual source is an element's `label`
 * (its accessible name), reported with `textSource: "accessibility"` —
 * exactly how the perception script treats aria-label fallbacks.
 */
export declare function runeTreeToVisibleElements(tree: RuneTree): VisibleElement[];
/**
 * Downscale a headless Rune PNG to the viewport the tree reports.
 *
 * Rune renders at the display scale (2x in this sandbox), so the raw PNG is
 * larger than the viewport and its pixels do not line up with the tree's
 * point coordinates. Every pixel check in EVE samples element boxes in
 * points, so a 2x screenshot makes them sample the wrong region: the hello
 * switch label read 1.00:1 and the name-form "Continue" label 1.10:1 this
 * way. A box average keeps the downscale deterministic, so identical
 * journals still replay to identical bytes.
 */
export declare function downscaleToViewport(png: Buffer, viewport: [number, number]): Buffer;
export declare class RuneAdapter implements BrowserAdapter {
    readonly name = "rune";
    readonly version = "0.5.0";
    /**
     * A visual surface like a browser, but a single-screen app: no history to
     * go back through and no scrollable content in the apps this driver runs,
     * so goBack/scroll are documented no-ops and the capabilities say so.
     */
    readonly capabilities: {
        readonly spatial: boolean;
        readonly modality: import("../index.js").Modality;
        readonly canScreenshot: boolean;
        readonly pointer: "mouse" | "touch";
        readonly canHover: boolean;
        readonly actionVerbs?: readonly string[];
        readonly canGoBack: false;
        readonly canScroll: false;
    };
    private binary;
    private workdir;
    private journal;
    private virtualTime;
    private lastPng;
    private lastTree;
    private lastRunWallMs;
    private recordStep;
    private opened;
    private readonly options;
    constructor(options?: RuneAdapterOptions);
    open(url: string, _viewport: Viewport): Promise<void>;
    snapshot(): Promise<RawSnapshot>;
    screenshot(): Promise<Buffer | null>;
    moveMouse(_point: Point): Promise<void>;
    clickAt(point: Point): Promise<void>;
    doubleClickAt(point: Point): Promise<void>;
    typeText(text: string, perCharIntervalMs: number): Promise<void>;
    pressKey(key: string): Promise<void>;
    scrollBy(_deltaY: number): Promise<void>;
    goBack(): Promise<void>;
    navigate(url: string): Promise<void>;
    close(): Promise<void>;
    lastWaitMs(): number | null;
    /**
     * Re-run the app headlessly with the full journal to the current virtual
     * time, refreshing the cached PNG and tree. Deterministic: the same
     * journal renders the same frames.
     */
    private run;
    /** Save this step's PNG, tree and journal for post-run grounding scoring. */
    private record;
    private requireTree;
}
//# sourceMappingURL=rune.d.ts.map