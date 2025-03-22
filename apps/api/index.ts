import { cors } from "@elysiajs/cors";
import { swagger } from "@elysiajs/swagger";
import { Elysia, file } from "elysia";
import { uploadRoutes } from "./routes/upload";
import { ENV } from "./env";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";

// Clean and build the frontend before starting the server
try {
	const publicDir = join(import.meta.dir, "public");

	// Clean the public folder if it exists
	if (existsSync(publicDir)) {
		console.log("🧹 Cleaning public folder...");
		await rm(publicDir, { recursive: true, force: true });
		console.log("✅ Public folder cleaned successfully");
	}

	// Build the frontend
	console.log("🛠️ Building frontend application...");
	const buildProcess = Bun.spawnSync(
		["bunx", "vite", "build", "--outDir", "./../api/public"],
		{
			cwd: "../uploader",
			stdout: "inherit",
			stderr: "inherit",
		},
	);

	if (buildProcess.exitCode !== 0) {
		console.error("❌ Frontend build failed");
	} else {
		console.log("✅ Frontend build completed successfully");
	}
} catch (error) {
	console.error("❌ Error during build process:", error);
}

const app = new Elysia()
	.use(cors())
	.use(
		swagger({
			exclude: ["/docs", "/docs/JSON"],
			path: "/docs",
			excludeTags: ["default"],
			documentation: {
				info: {
					title: "Image Optimizer API",
					version: "1.0.0",
					description: "API for image optimization",
				},
			},
		}),
	)
	.use(uploadRoutes)
	.get("/ping", () => "Hello from Image Optimizer API!")
	.get("/", () => Bun.file("public/index.html"))
	.get("/vite.svg", () => Bun.file("public/vite.svg"))
	.get("/assets/*", ({ params }) => file(`public/assets/${params["*"]}`))
	.get("/uploads/*", ({ params }) => file(`uploads/${params["*"]}`))
	.listen(ENV.PORT);

console.log(
	`🦊 Elysia server is running at http://${app.server?.hostname}:${app.server?.port}`,
);
console.log(
	`🦊 Elysia docs are running at http://${app.server?.hostname}:${app.server?.port}/docs`,
);
console.log(
	`📁 Static files are served from: http://${app.server?.hostname}:${app.server?.port}/uploads`,
);

export type App = typeof app;
