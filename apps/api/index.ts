import { cors } from "@elysiajs/cors";
import { swagger } from "@elysiajs/swagger";
import { Elysia } from "elysia";

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
	.get("/", () => "Hello from Elysia API!")
	.listen(3000);

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
