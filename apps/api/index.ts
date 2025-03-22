import { cors } from "@elysiajs/cors";
import { swagger } from "@elysiajs/swagger";
import { Elysia, file } from "elysia";
import { uploadRoutes } from "./routes/upload";
import { ENV } from "./env";
import { existsSync } from "node:fs";
import { rm, mkdir, cp } from "node:fs/promises";
import { join, resolve } from "node:path";
import { exec } from "node:child_process";

// Clean and build the frontend before starting the server
try {
	const publicDir = join(import.meta.dir, "public");

	// Clean the public folder if it exists
	if (existsSync(publicDir)) {
		console.log("🧹 Cleaning public folder...");
		await rm(publicDir, { recursive: true, force: true });
		console.log("✅ Public folder cleaned successfully");
	}

	// Create public directory if it doesn't exist
	if (!existsSync(publicDir)) {
		console.log("📁 Creating public directory...");
		await mkdir(publicDir, { recursive: true });
	}

	// Check if we're running in a container
	const isContainer = process.env.CONTAINER === "true";

	if (isContainer) {
		// In container: check if pre-built files exist in a mounted volume
		const prebuiltDir = process.env.PREBUILT_DIR || "/prebuilt";

		if (existsSync(prebuiltDir)) {
			console.log(`📦 Using pre-built frontend from ${prebuiltDir}`);
			await cp(prebuiltDir, publicDir, { recursive: true });
			console.log("✅ Frontend files copied successfully");
		} else {
			console.log("⚠️ Running in container without pre-built files");
			console.log(
				"❗ Please mount a volume with pre-built frontend files to /prebuilt",
			);
		}
	} else {
		// Not in container: try to build using local commands
		console.log("🛠️ Building frontend application...");

		const uploaderDir = resolve(import.meta.dir, "../uploader");

		// Use a more flexible command execution approach
		const buildCmd =
			process.platform === "win32"
				? "cd ../uploader && npm run build:prod"
				: "cd ../uploader && npm run build:prod";

		await new Promise((resolve, reject) => {
			exec(buildCmd, { cwd: import.meta.dir }, (error, stdout, stderr) => {
				if (error) {
					console.error(`❌ Build error: ${error.message}`);
					console.log("🔍 Attempting fallback build...");

					// Try fallback with npx
					exec(
						"cd ../uploader && npx vite build --outDir ../api/public",
						{ cwd: import.meta.dir },
						(fallbackError, fallbackStdout, fallbackStderr) => {
							if (fallbackError) {
								console.error(
									`❌ Fallback build failed: ${fallbackError.message}`,
								);
								// Continue execution despite error
								resolve(null);
							} else {
								console.log("✅ Fallback build completed successfully");
								resolve(null);
							}
						},
					);
				} else {
					console.log("✅ Frontend build completed successfully");
					resolve(null);
				}
			});
		});
	}
} catch (error) {
	console.error("❌ Error during build process:", error);
	// Continue with server startup despite build errors
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
