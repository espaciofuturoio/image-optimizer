import { cors } from "@elysiajs/cors";
import { swagger } from "@elysiajs/swagger";
import { Elysia, file } from "elysia";
import { uploadRoutes } from "./routes/upload";
import { ENV } from "./env";
import { compression } from "./libs/compress/index";

const app = new Elysia()
	.use(compression)
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
	.get("/assets/*", ({ params }) => file(`public/assets/${params["*"]}`))
	.get("/uploads/*", ({ params }) => file(`uploads/${params["*"]}`))
	.get("/image-optimizer-preview.webp", () =>
		Bun.file("public/image-optimizer-preview.webp"),
	)
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
