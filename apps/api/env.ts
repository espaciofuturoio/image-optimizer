import { z } from "zod";

const envSchema = z.object({
	PORT: z.number().default(3000),
	UPLOAD_DIR: z.string().default("./uploads"),
	PUBLIC_URL: z.string().default("/uploads"),
});

type Env = z.infer<typeof envSchema>;

let ENV: Env;

try {
	const parsed = envSchema.parse({
		...process.env,
	});
	ENV = {
		...parsed,
	};
} catch (err) {
	if (err instanceof z.ZodError) {
		console.error(err.issues);
	}
	process.exit(1);
}

export { ENV };
