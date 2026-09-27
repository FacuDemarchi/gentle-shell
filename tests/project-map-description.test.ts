import assert from "node:assert/strict";
import test from "node:test";
import { readCapabilityDescription } from "../lib/project-map-description.ts";

const DOCUMENT = [
	"# FP-1b — Provisioning",
	"",
	"## Objective",
	"",
	"Turn the declared deployment shape into a real one.",
	"",
	"## Work units",
	"",
	"- [ ] **FP-1b.1 — Supabase project: database and identity**",
	"  - Create the managed PostgreSQL project and its identity provider.",
	"  - Store every credential outside migrations, in the provider secret store.",
	"",
	"- [x] **FP-1b.2 — Railway: the API service** (deployable now)",
	"  - Deploy the API with the repository's own preflight script.",
	"",
	"- [ ] **FP-1b.3 — Domain and DNS**",
	"",
	"## Notes",
	"",
	"Everything above is non-secret by construction.",
	"",
].join("\n");

test("returns the body of the work unit whose title normalizes to the capability id", () => {
	const description = readCapabilityDescription(DOCUMENT, "supabase-project-database-and-identity");
	assert.ok(description, "expected the work unit to be found");
	assert.equal(description.title, "Supabase project: database and identity");
	assert.deepEqual(description.lines, [
		"Create the managed PostgreSQL project and its identity provider.",
		"Store every credential outside migrations, in the provider secret store.",
	]);
});

// The generator's own pattern refuses a line with anything after the closing `**`, which makes
// such a work unit invisible in the map with no omission at all. A reader that inherited that
// blind spot could never explain the capabilities that survived it.
test("tolerates trailing text after the closing emphasis", () => {
	const description = readCapabilityDescription(DOCUMENT, "railway-the-api-service");
	assert.ok(description, "expected a work unit with trailing text to be found");
	assert.equal(description.title, "Railway: the API service");
	assert.deepEqual(description.lines, ["Deploy the API with the repository's own preflight script."]);
});

test("matches the whole title when the label carries no separator", () => {
	const document = ["- [ ] **Close the gate**", "  - One body line.", ""].join("\n");
	const description = readCapabilityDescription(document, "close-the-gate");
	assert.ok(description);
	assert.equal(description.title, "Close the gate");
	assert.deepEqual(description.lines, ["One body line."]);
});

test("a work unit with no body is found, with an empty body rather than null", () => {
	const description = readCapabilityDescription(DOCUMENT, "domain-and-dns");
	assert.ok(description, "expected the work unit to be found");
	assert.deepEqual(description.lines, []);
});

test("stops at the next work unit and at an unindented line", () => {
	const description = readCapabilityDescription(DOCUMENT, "supabase-project-database-and-identity");
	assert.ok(description);
	assert.ok(!description.lines.some((line) => line.includes("Deploy the API")), "the next work unit's body is not this one's");
	assert.ok(!description.lines.some((line) => line.includes("non-secret")), "the section after the list is not a body");
});

test("strips the bullet marker and normalizes whitespace, keeping the text verbatim", () => {
	const document = ["- [ ] **Catalog**", "  -   Two   spaces   collapse, and `code` stays.", "  * A star bullet works too.", ""].join("\n");
	const description = readCapabilityDescription(document, "catalog");
	assert.ok(description);
	assert.deepEqual(description.lines, ["Two spaces collapse, and `code` stays.", "A star bullet works too."]);
});

test("does not match a work unit whose title normalizes to a different id", () => {
	assert.equal(readCapabilityDescription(DOCUMENT, "supabase-project"), null);
	assert.equal(readCapabilityDescription(DOCUMENT, "not-a-work-unit"), null);
});

test("an empty document and an empty id answer nothing rather than throwing", () => {
	assert.equal(readCapabilityDescription("", "catalog"), null);
	assert.equal(readCapabilityDescription(DOCUMENT, ""), null);
});
