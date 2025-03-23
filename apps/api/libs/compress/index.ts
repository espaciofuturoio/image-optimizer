import Elysia from "elysia";

type SupportedEncoding = "br" | "gzip" | "deflate";

type CompressionOptions = {
	encodings: SupportedEncoding[];
	threshold: number;
	contentTypes?: string[];
};

const defaultOptions: CompressionOptions = {
	encodings: ["gzip", "br", "deflate"],
	threshold: 2048,
	contentTypes: [
		"application/json",
		"text/plain",
		"text/html",
		"text/css",
		"text/javascript",
		"application/javascript",
	],
};

// Bun currently supports gzip and deflate natively
// For brotli, we'll fallback to gzip since built-in support may be added in future versions
const compressors = {
	// Current Bun version doesn't have native brotli support, fallback to gzip
	br: (data: Uint8Array) => Bun.gzipSync(data),
	gzip: (data: Uint8Array) => Bun.gzipSync(data),
	deflate: (data: Uint8Array) => Bun.deflateSync(data),
};

function isValidEncoding(
	encoding: string,
): encoding is keyof typeof compressors {
	return Object.keys(compressors).includes(encoding);
}

function getContentType(
	response: unknown,
	headers: Record<string, string | number>,
): string {
	// Check if Content-Type is already set in headers
	if (headers["Content-Type"]) {
		return String(headers["Content-Type"]);
	}

	// Determine content type based on response
	if (typeof response === "object") {
		return "application/json; charset=utf-8";
	}

	return "text/plain; charset=utf-8";
}

export const compression = (options: Partial<CompressionOptions> = {}) => {
	const opts = { ...defaultOptions, ...options };

	return new Elysia({ name: "compressResponses" })
		.mapResponse(({ request, response, set }) => {
			// Parse the Accept-Encoding header
			const acceptEncoding = request.headers.get("Accept-Encoding") || "";
			const preferredEncoding = acceptEncoding
				.split(",")
				.map((e) => e.trim().split(";")[0]) // Handle quality values like gzip;q=0.8
				.find((enc) => opts.encodings.includes(enc as SupportedEncoding));

			if (!preferredEncoding || !isValidEncoding(preferredEncoding)) {
				return response as Response;
			}

			const contentType = getContentType(response, set.headers);
			const contentTypeMatches =
				!opts.contentTypes ||
				opts.contentTypes.some((type) => String(contentType).startsWith(type));

			if (!contentTypeMatches) {
				return response as Response;
			}

			// Convert response to string/buffer
			const text =
				typeof response === "object"
					? JSON.stringify(response)
					: (response?.toString() ?? "");

			// Only compress if content is larger than threshold
			if (text.length < opts.threshold) {
				return response as Response;
			}

			// Set encoding header and compress
			set.headers["Content-Encoding"] = preferredEncoding;
			const data = new TextEncoder().encode(text);

			return new Response(compressors[preferredEncoding](data), {
				headers: {
					"Content-Type": contentType,
					Vary: "Accept-Encoding",
				},
			});
		})
		.as("plugin");
};
