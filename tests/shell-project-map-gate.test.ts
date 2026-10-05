import assert from "node:assert/strict";
import test from "node:test";
import {
	PROJECT_MAP_EXECUTABLE_ENV,
	projectMapExecutableEnabled,
	projectMapExecutableRefusal,
} from "../lib/shell-project-map-gate.ts";

/**
 * The gate is a plain predicate over an environment object, so it can be pinned without Pi,
 * without a repository and without a store. It is deliberately fail-closed: only an explicit
 * on-value enables the executable half, and every other value — including one that looks
 * like an attempt — leaves it off and is named in the refusal.
 */
test("the executable half is off unless it is explicitly switched on", () => {
	for (const value of ["1", "true", "on", "TRUE", "On", " 1 "]) {
		assert.equal(projectMapExecutableEnabled({ [PROJECT_MAP_EXECUTABLE_ENV]: value }), true, `${JSON.stringify(value)} enables`);
		assert.equal(projectMapExecutableRefusal({ [PROJECT_MAP_EXECUTABLE_ENV]: value }), undefined, `${JSON.stringify(value)} has nothing to refuse`);
	}
	for (const value of [undefined, "", "0", "false", "off", "yes", "enabled", "2"]) {
		const env = value === undefined ? {} : { [PROJECT_MAP_EXECUTABLE_ENV]: value };
		assert.equal(projectMapExecutableEnabled(env), false, `${JSON.stringify(value)} does not enable`);
		assert.notEqual(projectMapExecutableRefusal(env), undefined, `${JSON.stringify(value)} is refused`);
	}
});

test("the refusal names the switch and every value that enables it", () => {
	const message = projectMapExecutableRefusal({});
	assert.ok(message !== undefined);
	assert.match(message, new RegExp(PROJECT_MAP_EXECUTABLE_ENV));
	assert.match(message, /1, true, on/);
	assert.match(message, /disabled/i);
});

test("a value that is neither on nor off is reported rather than silently ignored", () => {
	const message = projectMapExecutableRefusal({ [PROJECT_MAP_EXECUTABLE_ENV]: "yes" });
	assert.ok(message !== undefined);
	assert.match(message, /"yes"/);
	assert.match(message, /1, true, on/);
});

test("an empty value is treated as unset, not as an unrecognized attempt", () => {
	const empty = projectMapExecutableRefusal({ [PROJECT_MAP_EXECUTABLE_ENV]: "   " });
	const unset = projectMapExecutableRefusal({});
	assert.equal(empty, unset);
	assert.doesNotMatch(empty!, /""/);
});
