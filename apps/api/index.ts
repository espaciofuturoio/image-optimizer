import { cors } from "@elysiajs/cors";
import { staticPlugin } from "@elysiajs/static";
import { swagger } from "@elysiajs/swagger";
import { Elysia } from "elysia";
import { uploadRoutes } from "./routes/upload";
import { ENV } from "./env";

const app = new Elysia()
	.use(cors())
	.use(
		swagger({
			exclude: ["/docs", "/docs/JSON"],
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
	.use(staticPlugin({ prefix: "/", assets: "./public" }))
	// Serve static files from uploads directory
	.use(
		staticPlugin({
			assets: "./uploads", // The directory containing uploaded files
			prefix: "/uploads", // The URL prefix to access these files
		}),
	)
	.use(uploadRoutes)
	.get("/ping", () => "Hello from Image Optimizer API!")
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
