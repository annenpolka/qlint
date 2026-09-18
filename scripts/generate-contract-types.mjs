/**
 * Generates TypeScript views of the shipped JSON Schemas into tests/generated/.
 *
 * The schemas are the source of truth for structure; tests/type-consistency/
 * asserts that src/contracts.ts is mutually assignable with this output, so a
 * schema edit that the hand-written types do not follow fails `npm test`.
 * Not part of the build: nothing in src/ imports the generated files.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { compile } from "json-schema-to-typescript";

const root = new URL("../", import.meta.url);

/** json-schema-to-typescript expects draft-07 style $defs/definitions. */
function normalize(raw) {
  const schema = JSON.parse(raw.replaceAll("#/$defs/", "#/definitions/").replace('"$defs"', '"definitions"'));
  delete schema.$schema;
  delete schema.title;
  return schema;
}

const options = {
  bannerComment: "",
  additionalProperties: false,
  ignoreMinAndMaxItems: true,
};

const targets = [
  { schema: "schemas/question-suite.schema.json", typeName: "QuestionSuite", out: "tests/generated/question-suite.ts" },
  { schema: "schemas/diagnostic.schema.json", typeName: "Diagnostic", out: "tests/generated/diagnostic.ts" },
];

mkdirSync(new URL("tests/generated/", root), { recursive: true });
for (const target of targets) {
  const raw = readFileSync(new URL(target.schema, root), "utf8");
  const generated = await compile(normalize(raw), target.typeName, options);
  writeFileSync(new URL(target.out, root), `${generated.trimEnd()}\n`);
  console.log(`generated ${target.out} from ${target.schema}`);
}
