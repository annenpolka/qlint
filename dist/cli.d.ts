#!/usr/bin/env node
export declare const USAGE = "qlint \u2014 question contract checker (reference static lint)\n\nUsage:\n  qlint lint <suite.json> [--capabilities <caps.json>] [--format text|json]\n  qlint --help\n  qlint --version\n\nExit codes:\n  0  every check lint performs completed and found no violations\n  1  the input violated the suite contract or the JSON Schema\n  2  usage, I/O, or tool-configuration failure\n  3  reserved for profile runs whose required checks were not completed (lint never uses it)\n\nlint runs JSON Schema validation and cross-reference checks only.\nSemantic screening, dataset probes, metamorphic tests, fuzzing, and calibration\nare NOT run; the report lists them under \"not run\" and never presents a clean\nstatic lint as semantic approval.";
export interface CliStreams {
    stdout(text: string): void;
    stderr(text: string): void;
}
export declare function run(argv: string[], streams: CliStreams): number;
