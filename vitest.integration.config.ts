import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		include: ["tests/integration/**/*.test.ts"],
		testTimeout: 60000,
		hookTimeout: 90000,
		// Run serially — tests modify shared Apple Reminders state
		sequence: {
			concurrent: false,
		},
	},
});
