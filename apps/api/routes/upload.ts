import * as fs from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { Elysia, t } from "elysia";
import { nanoid } from "nanoid";
import sharp from "sharp";
import { ENV } from "../env";

// Configure upload directory
const UPLOAD_DIR = ENV.UPLOAD_DIR || "./uploads";
// The URL should be relative to the server, not absolute with localhost
const PUBLIC_URL = ENV.PUBLIC_URL || "/uploads";

// Ensure upload directory exists
try {
	await mkdir(UPLOAD_DIR, { recursive: true });
} catch (error) {
	console.error("Failed to create upload directory:", error);
}

export const uploadRoutes = new Elysia({ prefix: "/upload" }).post(
	"/optimize",
	async ({ body, set }) => {
		try {
			const { file } = body;
			const format = body.format || "webp";
			// Parse numeric values from form data strings
			const quality = body.quality ? Number(body.quality) : 80;
			const width = body.width ? Number(body.width) : undefined;
			const height = body.height ? Number(body.height) : undefined;
			const sourceFormat = body.sourceFormat || "unknown";

			if (!file || !file.size) {
				set.status = 400;
				return { error: "Invalid file data" };
			}

			// Get file buffer
			const buffer = await file.arrayBuffer();

			// Generate unique ID for the file
			const fileId = nanoid();
			const outputFormat = ["webp", "avif", "jpeg", "png"].includes(format)
				? format
				: "webp";
			const filename = `${fileId}.${outputFormat}`;
			const outputPath = join(UPLOAD_DIR, filename);

			console.log(
				`Processing image: sourceFormat=${sourceFormat}, targetFormat=${outputFormat}, size=${file.size}`,
			);

			// Process image with sharp
			let sharpInstance = sharp(Buffer.from(buffer));

			// Get initial metadata to help with debugging
			try {
				const inputMetadata = await sharpInstance.metadata();
				console.log(
					"Input image metadata:",
					JSON.stringify({
						format: inputMetadata.format,
						width: inputMetadata.width,
						height: inputMetadata.height,
						space: inputMetadata.space,
						channels: inputMetadata.channels,
					}),
				);
			} catch (metaErr) {
				console.warn("Could not read input metadata:", metaErr);
			}

			// Keep original buffer for recovery
			const originalBuffer = Buffer.from(buffer);

			// AVIF can be problematic in Sharp - for all AVIF source files, decode through JPEG first
			if (sourceFormat === "avif") {
				try {
					console.log(
						"Processing AVIF through intermediate JPEG for better compatibility",
					);
					console.log(`Original requested output format is: ${outputFormat}`);

					// Try a different approach using temporary files for more reliable processing
					const tempJpegPath = join(UPLOAD_DIR, `${fileId}_temp.jpg`);

					try {
						// Save to a temporary JPEG file first
						await sharp(originalBuffer)
							.jpeg({ quality: 90 })
							.toFile(tempJpegPath);

						// Create new sharp instance from the JPEG file - this will be converted to the requested format later
						sharpInstance = sharp(tempJpegPath);
						console.log(
							"AVIF intermediate conversion through temp file successful",
						);
					} catch (tempFileErr) {
						console.error("Temp file approach failed:", tempFileErr);

						// Fall back to in-memory conversion as before
						const jpegBuffer = await sharp(originalBuffer)
							.jpeg({ quality: 90 })
							.toBuffer();
						sharpInstance = sharp(jpegBuffer);
						console.log(
							"AVIF intermediate conversion through memory successful",
						);
					} finally {
						// Clean up temp file if it exists
						try {
							if (fs.existsSync(tempJpegPath)) {
								fs.unlinkSync(tempJpegPath);
							}
						} catch (cleanupErr) {
							console.warn("Failed to clean up temp file:", cleanupErr);
						}
					}

					console.log(
						`Successfully decoded AVIF through JPEG, will now convert to final format: ${outputFormat}`,
					);
				} catch (avifErr) {
					console.error("All AVIF intermediate conversions failed:", avifErr);
					// Continue with original approach as last resort
				}
			}

			// Resize if dimensions provided
			if (width || height) {
				sharpInstance = sharpInstance.resize({
					width: width || undefined,
					height: height || undefined,
					fit: "inside",
					withoutEnlargement: true,
				});
			}

			// Format conversion and compression
			switch (outputFormat) {
				case "webp":
					console.log(`Applying WebP conversion with quality: ${quality}`);
					sharpInstance = sharpInstance.webp({ quality });
					break;
				case "avif":
					console.log(`Applying AVIF conversion with quality: ${quality}`);
					// Use more conservative AVIF settings to increase compatibility
					sharpInstance = sharpInstance.avif({
						quality,
						effort: 4, // Balance between speed and compression (0-9, less-more effort)
						chromaSubsampling: "4:2:0", // Standard subsampling for better compatibility
					});
					break;
				case "jpeg":
					console.log(`Applying JPEG conversion with quality: ${quality}`);
					sharpInstance = sharpInstance.jpeg({ quality });
					break;
				case "png":
					console.log(`Applying PNG conversion with quality: ${quality}`);
					sharpInstance = sharpInstance.png({ quality });
					break;
			}

			// Process the image and get the buffer
			try {
				console.log(
					`Applying final format conversion to: ${outputFormat} with quality: ${quality}`,
				);
				const outputBuffer = await sharpInstance.toBuffer();
				console.log(
					`Format conversion successful, buffer size: ${outputBuffer.length}`,
				);

				// Write file using the fs module directly
				fs.writeFileSync(outputPath, new Uint8Array(outputBuffer));
				console.log(`File written successfully to ${outputPath}`);

				// Get image metadata
				const metadata = await sharp(outputBuffer).metadata();
				console.log(
					`Output metadata: ${JSON.stringify({
						format: metadata.format,
						width: metadata.width,
						height: metadata.height,
					})}`,
				);

				console.log(
					`Image processed successfully: id=${fileId}, format=${outputFormat}, size=${outputBuffer.length}`,
				);

				return {
					success: true,
					result: {
						id: fileId,
						format: outputFormat,
						size: outputBuffer.length,
						width: metadata.width,
						height: metadata.height,
						url: `${PUBLIC_URL}/${filename}`,
					},
				};
			} catch (processError) {
				console.error("Error during final image processing:", processError);
				set.status = 500;
				return {
					error: "Image processing failed in final stage",
					details: String(processError),
					stage: "final_processing",
				};
			}
		} catch (error) {
			console.error("Image optimization failed:", error);
			set.status = 500;
			return { error: "Image processing failed", details: String(error) };
		}
	},
	{
		body: t.Object({
			file: t.File({
				type: [
					"image/jpeg",
					"image/png",
					"image/webp",
					"image/gif",
					"image/avif",
				],
			}),
			format: t.Optional(t.String()),
			quality: t.Optional(t.String()),
			width: t.Optional(t.String()),
			height: t.Optional(t.String()),
			sourceFormat: t.Optional(t.String()),
		}),
	},
);
