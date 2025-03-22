import { useState } from 'react'
import { uploadImage } from './upload'
import {
  compressImage,
  convertToWebP,
  optimizeImageServer,
  isHeicOrHeifImage,
  convertHeicToJpeg,
  isAvifImage,
  convertAvifToWebP,
} from './imageCompressionUtil'

// Define accepted file types
const ACCEPTED_FILE_TYPES = "image/jpeg,image/png,image/gif,image/webp,image/avif,image/heic,image/heif"
const ACCEPTED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.heic', '.heif']

// Default configuration values
const DEFAULT_QUALITY = 75
const DEFAULT_MAX_SIZE_MB = 1
const DEFAULT_MAX_RESOLUTION = 2048
const DEFAULT_FORMAT = 'webp'
const MAX_FILE_SIZE_MB = 40 // 40MB file size limit

// Utility function to format bytes into KB and MB
const formatBytes = (bytes: number) => {
  if (bytes === 0) return '0 KB'
  const k = 1024
  const kb = (bytes / k).toFixed(2)
  const mb = (bytes / (k * k)).toFixed(2)
  return bytes < k * k ? `${kb} KB` : `${mb} MB`
}

// Utility function to validate file
const validateFile = (file: File): { valid: boolean; message: string } => {
  // Check file size (40MB limit)
  if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
    return {
      valid: false,
      message: `File too large. Maximum size is ${MAX_FILE_SIZE_MB}MB.`
    };
  }

  // Validate MIME type
  const validMimeType = ACCEPTED_FILE_TYPES.includes(file.type);

  // Check if it's a likely video file based on common video MIME types
  if (file.type.startsWith('video/')) {
    return {
      valid: false,
      message: 'Videos are not supported. Please upload an image file.'
    };
  }

  // Double-check file extension as fallback
  const fileName = file.name.toLowerCase();
  const hasValidExtension = ACCEPTED_EXTENSIONS.some(ext => fileName.endsWith(ext));

  // Check for common video extensions, even if MIME type wasn't detected correctly
  const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.avi', '.wmv', '.flv', '.webm', '.mkv', '.m4v'];
  if (VIDEO_EXTENSIONS.some(ext => fileName.endsWith(ext))) {
    return {
      valid: false,
      message: 'Videos are not supported. Please upload an image file.'
    };
  }

  if (!validMimeType && !hasValidExtension) {
    return {
      valid: false,
      message: 'Invalid file type. Only images are accepted.'
    };
  }

  return { valid: true, message: '' };
};

// Read the first few bytes of a file to check its signature
const readFileHeader = async (file: File): Promise<Uint8Array> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const arr = new Uint8Array(reader.result as ArrayBuffer);
      resolve(arr.slice(0, 16)); // Increased to 16 bytes to better detect video formats
    };
    reader.onerror = () => reject(new Error('Failed to read file header'));

    // Read only the beginning of the file
    const blob = file.slice(0, 16);
    reader.readAsArrayBuffer(blob);
  });
};

// Check if the file header corresponds to a valid image format
const isValidImageHeader = (header: Uint8Array): boolean => {
  // First check for video/document formats that should be rejected

  // Check for MP4/QuickTime formats ('ftyp' at bytes 4-7 and common subtypes)
  const isFtyp = header[4] === 0x66 && header[5] === 0x74 && header[6] === 0x79 && header[7] === 0x70;
  if (isFtyp) {
    // Check for common video format subtypes
    const subtype = String.fromCharCode.apply(null, Array.from(header.slice(8, 12)));
    const videoSubtypes = ['mp4', 'avc', 'iso', 'MP4', 'qt', 'mov', 'M4V', 'm4v'];
    if (videoSubtypes.some(type => subtype.includes(type))) {
      return false; // This is a video file, not an image
    }
  }

  // Check for WebM video signature (bytes 0-3: 0x1A 0x45 0xDF 0xA3)
  if (header[0] === 0x1A && header[1] === 0x45 && header[2] === 0xDF && header[3] === 0xA3) {
    return false; // WebM video file
  }

  // Check for AVI format (starts with "RIFF" and then has "AVI")
  if (header[0] === 0x52 && header[1] === 0x49 && header[2] === 0x46 && header[3] === 0x46 &&
    header[8] === 0x41 && header[9] === 0x56 && header[10] === 0x49) {
    return false; // AVI video file
  }

  // Now check for valid image formats

  // JPEG signature: starts with FF D8
  if (header[0] === 0xFF && header[1] === 0xD8) return true;

  // PNG signature: 89 50 4E 47 0D 0A 1A 0A
  if (header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4E && header[3] === 0x47) return true;

  // GIF signature: "GIF87a" (47 49 46 38 37 61) or "GIF89a" (47 49 46 38 39 61)
  if (header[0] === 0x47 && header[1] === 0x49 && header[2] === 0x46 && header[3] === 0x38 &&
    (header[4] === 0x37 || header[4] === 0x39) && header[5] === 0x61) return true;

  // WebP: starts with "RIFF" and later contains "WEBP"
  if (header[0] === 0x52 && header[1] === 0x49 && header[2] === 0x46 && header[3] === 0x46 &&
    header[8] === 0x57 && header[9] === 0x45 && header[10] === 0x42 && header[11] === 0x50) return true;

  // HEIC/HEIF can be harder to detect, often start with "ftyp"
  // Basic check for AVIF/HEIF containers, but make sure it's not a video subtype
  if (isFtyp) {
    const subtype = String.fromCharCode.apply(null, Array.from(header.slice(8, 12)));
    const imageSubtypes = ['heic', 'mif1', 'msf1', 'avif', 'hevc'];
    if (imageSubtypes.some(type => subtype.includes(type))) {
      return true; // This is a HEIC/AVIF image
    }
  }

  return false;
};

export const SimpleImageUploader: React.FC = () => {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState<boolean>(false)
  const [uploadStatus, setUploadStatus] = useState<{
    success: boolean;
    message: string;
  }>({ success: true, message: '' })
  const [toast, setToast] = useState({ visible: false, message: '' })
  const [originalFile, setOriginalFile] = useState<File | null>(null)
  const [originalSize, setOriginalSize] = useState<number | null>(null)
  const [serverStats, setServerStats] = useState<{
    size: number;
    width: number;
    height: number;
    format: string;
  } | null>(null)
  const [originalDimensions, setOriginalDimensions] = useState<{ width: number, height: number } | null>(null)
  const [isHeicConverted, setIsHeicConverted] = useState(false)
  const [uploadedUri, setUploadedUri] = useState<string | null>(null)
  const [processingImage, setProcessingImage] = useState(false)
  const [sliderPosition, setSliderPosition] = useState(50)
  const [useSliderComparison, setUseSliderComparison] = useState(true)

  // Simple toast notification system
  const showToast = (message: string, duration = 3000) => {
    setToast({ visible: true, message });
    setTimeout(() => {
      setToast({ visible: false, message: '' });
    }, duration);
  };

  // Handle slider drag
  const handleSliderChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setSliderPosition(Number(event.target.value));
  };

  // Handle mouse move on slider container for touch devices
  const handleMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.buttons !== 1) return; // Only execute during drag (left mouse button)

    const container = event.currentTarget;
    const rect = container.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const position = (x / rect.width) * 100;

    // Clamp position between 0 and 100
    setSliderPosition(Math.max(0, Math.min(100, position)));
  };

  // Handle touch move on slider container for mobile devices
  const handleTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    const container = event.currentTarget;
    const rect = container.getBoundingClientRect();
    const touch = event.touches[0];
    const x = touch.clientX - rect.left;
    const position = (x / rect.width) * 100;

    // Clamp position between 0 and 100
    setSliderPosition(Math.max(0, Math.min(100, position)));

    // Prevent scrolling while dragging
    event.preventDefault();
  };

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0]
    if (!selectedFile) return

    // Validate file before processing
    const validation = validateFile(selectedFile);
    if (!validation.valid) {
      setUploadStatus({ success: false, message: validation.message });
      showToast(validation.message);
      return;
    }

    // Clear previous state completely
    setPreviewUrl(null)
    setUploadedUrl(null)
    setUploadStatus({ success: true, message: '' })
    setServerStats(null)
    setOriginalDimensions(null)
    setIsHeicConverted(false)
    setProcessingImage(true)
    setUploadedUri(null)

    try {
      // Save original file info
      setOriginalFile(selectedFile)
      setOriginalSize(selectedFile.size)

      // Process the file (matching the original uploader's logic)
      await processAndUploadFile(selectedFile)
    } catch (error) {
      console.error('Error processing image:', error)
      showToast(`Error: ${error instanceof Error ? error.message : String(error)}`)
      setProcessingImage(false)
    }
  }

  const processAndUploadFile = async (selectedFile: File) => {
    try {
      // Additional security check - re-validate mime type by checking file signature
      // This helps prevent file type spoofing
      const fileHeader = await readFileHeader(selectedFile);
      if (!isValidImageHeader(fileHeader)) {
        // Try to determine if this is a video file or something else
        const headerStr = String.fromCharCode.apply(null, Array.from(fileHeader.slice(0, 16)));

        if (headerStr.includes('ftyp') && ['mp4', 'qt', 'mov', 'M4V'].some(str => headerStr.includes(str))) {
          throw new Error('Video files cannot be processed. Please upload an image file instead.');
        } else if (headerStr.includes('RIFF') && headerStr.includes('AVI')) {
          throw new Error('Video files cannot be processed. Please upload an image file instead.');
        } else if ([0x1A, 0x45, 0xDF, 0xA3].every((val, i) => fileHeader[i] === val)) {
          throw new Error('WebM video files cannot be processed. Please upload an image file instead.');
        } else {
          throw new Error('File appears to be corrupted or not a valid image format.');
        }
      }

      // Set original preview
      const previewObjectUrl = URL.createObjectURL(selectedFile);
      setPreviewUrl(previewObjectUrl);

      // Extract original dimensions
      const img = new Image();
      img.onload = () => {
        setOriginalDimensions({
          width: img.width,
          height: img.height
        });
      };
      img.src = previewObjectUrl;

      // Check if file is HEIC/HEIF format
      let isHeic = false;
      if (!selectedFile.type.includes('jpeg') && !selectedFile.type.includes('jpg')) {
        try {
          isHeic = await isHeicOrHeifImage(selectedFile);
        } catch (error) {
          console.error('Error during HEIC detection:', error);
        }
      }

      // Handle HEIC conversion if needed
      let processedFile = selectedFile;
      if (isHeic) {
        try {
          showToast('Converting HEIC for preview...');
          const jpegFile = await convertHeicToJpeg(selectedFile, DEFAULT_QUALITY);
          if (jpegFile && jpegFile.size > 0) {
            setPreviewUrl(URL.createObjectURL(jpegFile));
            setIsHeicConverted(true);
            processedFile = jpegFile;
            showToast('HEIC converted to JPG for display');
          }
        } catch (heicError) {
          console.error('HEIC conversion failed:', heicError);
          showToast('HEIC conversion failed. File may not display correctly.');
        }
      }

      // Client-side processing
      let clientProcessedFile = processedFile;

      // Handle AVIF conversion if needed
      const isAvifSource = isAvifImage(processedFile);
      if (isAvifSource) {
        showToast('Processing AVIF image...');
        try {
          const webpFile = await convertAvifToWebP(processedFile, DEFAULT_QUALITY);
          if (webpFile && webpFile.size > 0) {
            clientProcessedFile = webpFile;
          }
        } catch (avifError) {
          console.error('AVIF conversion failed:', avifError);
        }
      }
      // Apply WebP conversion for non-AVIF files
      else if (DEFAULT_FORMAT === 'webp') {
        try {
          clientProcessedFile = await convertToWebP(processedFile, DEFAULT_QUALITY);
        } catch (webpError) {
          console.error('WebP conversion failed:', webpError);
        }
      }

      // Apply basic compression
      try {
        clientProcessedFile = await compressImage(clientProcessedFile, {
          maxSizeMB: DEFAULT_MAX_SIZE_MB,
          maxWidthOrHeight: DEFAULT_MAX_RESOLUTION,
          useWebWorker: true,
          alwaysKeepResolution: false,
        });
      } catch (compressionError) {
        console.error('Compression failed:', compressionError);
      }

      // Send to server for optimization
      setIsUploading(true);
      showToast('Uploading to server for optimization...');

      try {
        // Use server-side optimization
        const result = await optimizeImageServer(clientProcessedFile, {
          format: DEFAULT_FORMAT as 'webp' | 'avif' | 'jpeg' | 'png',
          quality: DEFAULT_QUALITY,
          width: DEFAULT_MAX_RESOLUTION,
          height: undefined,
          isHeic: isHeic,
          sourceFormat: processedFile.type.split('/')[1] || undefined
        });

        if (result.success) {
          // Save the detailed image info
          setServerStats({
            size: result.size,
            width: result.width,
            height: result.height,
            format: result.format
          });

          setUploadedUrl(result.url);
          setUploadStatus({ success: true, message: 'Image optimized and uploaded successfully' });
          showToast('Image upload complete!');
        } else {
          // Try direct upload as fallback
          await directUpload(clientProcessedFile);
        }
      } catch (error) {
        console.error('Server optimization failed:', error);
        showToast('Server optimization failed. Trying direct upload...');

        // Fallback to direct upload
        await directUpload(clientProcessedFile);
      }
    } catch (error) {
      console.error('Processing failed:', error);
      setUploadStatus({ success: false, message: String(error) });
    } finally {
      setIsUploading(false);
      setProcessingImage(false);
    }
  };

  const directUpload = async (fileToUpload: File) => {
    try {
      showToast('Performing direct upload...');
      const response = await uploadImage(fileToUpload);
      const url = response.result?.variants?.[0];
      const uri = response.result?.id;

      if (url) {
        setUploadedUrl(url);
        setUploadedUri(uri);

        // Estimate stats based on client-side knowledge
        if (fileToUpload) {
          setServerStats({
            size: fileToUpload.size,
            width: 0, // We don't know the dimensions from direct upload
            height: 0,
            format: fileToUpload.type.split('/')[1] || 'unknown'
          });
        }

        setUploadStatus({ success: true, message: 'Image uploaded successfully' });
        showToast('Image uploaded successfully');
        return true;
      } else {
        throw new Error('Upload returned no URL');
      }
    } catch (error) {
      console.error('Direct upload failed:', error);
      setUploadStatus({
        success: false,
        message: error instanceof Error ? error.message : 'Upload failed'
      });
      showToast('Upload failed. Please try again.');
      return false;
    }
  };

  // Calculate reduction percentage
  const reductionPercentage = () => {
    if (!originalSize || !serverStats) return null;
    return ((originalSize - serverStats.size) / originalSize * 100).toFixed(1);
  }

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      showToast('Copied to clipboard!')
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  const handleDownloadImage = async () => {
    if (!uploadedUrl) return;

    try {
      showToast('Preparing download...');

      // Try to handle potential CORS issues by fetching the image first
      try {
        const response = await fetch(uploadedUrl, { mode: 'cors' });
        if (!response.ok) throw new Error('Failed to fetch image');

        const blob = await response.blob();

        // Create object URL from the blob
        const objectUrl = URL.createObjectURL(blob);

        // Generate filename from original filename or create a new one
        let filename = '';
        if (originalFile?.name) {
          // Extract base name without extension
          const baseName = originalFile.name.replace(/\.[^/.]+$/, '');
          // Use server format or fallback to extracted format from URL
          const format = serverStats?.format || uploadedUrl.split('.').pop() || 'webp';
          filename = `${baseName}.${format}`;
        } else {
          // Fallback to URL filename or generate one
          const urlFilename = uploadedUrl.split('/').pop();
          if (urlFilename && urlFilename.includes('.')) {
            filename = urlFilename;
          } else {
            filename = `image-${Date.now()}.${serverStats?.format || 'webp'}`;
          }
        }

        // Create a temporary link and trigger download
        const link = document.createElement('a');
        link.href = objectUrl;
        link.download = filename;
        link.style.display = 'none';

        // Add to DOM, click and cleanup
        document.body.appendChild(link);
        link.click();

        // Cleanup after a short delay to ensure download starts
        setTimeout(() => {
          document.body.removeChild(link);
          URL.revokeObjectURL(objectUrl);
        }, 100);

        showToast('Download started!');
      } catch (fetchError) {
        console.warn('Fetch download failed, falling back to direct link:', fetchError);

        // Fallback to direct download if fetch fails
        const link = document.createElement('a');
        link.href = uploadedUrl;

        // Generate filename from the URL or use a default
        const urlParts = uploadedUrl.split('/');
        let filename = urlParts[urlParts.length - 1];

        if (!filename.includes('.')) {
          if (originalFile?.name) {
            const originalExt = originalFile.name.split('.').pop();
            const newExt = serverStats?.format || 'webp';
            filename = originalFile.name.replace(
              new RegExp(`\\.${originalExt}$`),
              `.${newExt}`
            );
          } else {
            filename = `image-${Date.now()}.${serverStats?.format || 'webp'}`;
          }
        }

        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        showToast('Download initiated via direct link');
      }
    } catch (error) {
      console.error('Download failed:', error);
      showToast('Download failed. Try right-clicking the image and selecting "Save Image As..."');
    }
  };

  return (
    <div className="flex flex-col items-center p-4">
      {/* File Input */}
      <div className="form-control w-full max-w-xs">
        <label className="label">
          <span className="label-text">Upload Image</span>
        </label>
        <input
          type="file"
          accept={ACCEPTED_FILE_TYPES}
          className="file-input file-input-bordered file-input-primary w-full"
          onChange={handleFileSelect}
          disabled={isUploading || processingImage}
        />
        <label className="label">
          <span className="label-text-alt">Supported: JPEG, PNG, GIF, WebP, AVIF, HEIC</span>
        </label>
      </div>

      {/* Enhanced Loading Animation */}
      {(isUploading || processingImage) && (
        <div className="card bg-base-100 shadow-xl w-full max-w-md my-4 animate-pulse">
          <div className="card-body items-center text-center">
            <div className="flex flex-col items-center">
              <div className="loading loading-spinner loading-lg text-primary mb-3"></div>
              <h3 className="font-bold text-lg">
                {isUploading ? 'Optimizing on server...' : 'Processing image...'}
              </h3>
              <p className="text-sm text-base-content/70 mt-2">
                {isUploading
                  ? 'Your image is being optimized for best quality and size'
                  : 'Preparing your image for optimization'}
              </p>
              <div className="w-full bg-base-200 rounded-full h-2.5 mt-4">
                <div className="bg-primary h-2.5 rounded-full w-3/4 animate-[pulse_2s_ease-in-out_infinite]"></div>
              </div>
            </div>
          </div>
        </div>
      )}

      {uploadStatus.success === false && (
        <div className="alert alert-error my-4 w-full max-w-md">
          <span>{uploadStatus.message || 'Upload failed'}</span>
        </div>
      )}

      {/* Image Comparison - Only show when not processing */}
      {!processingImage && !isUploading && originalFile && previewUrl && uploadedUrl && serverStats && (
        <div className="w-full max-w-4xl mt-4">
          <h3 className="text-xl font-bold mb-4 text-center">Image Comparison</h3>

          {/* Comparison view toggle */}
          <div className="flex justify-center mb-4">
            <div className="btn-group">
              <button
                className={`btn btn-sm ${useSliderComparison ? 'btn-active' : ''}`}
                onClick={() => setUseSliderComparison(true)}
              >
                Slider View
              </button>
              <button
                className={`btn btn-sm ${!useSliderComparison ? 'btn-active' : ''}`}
                onClick={() => setUseSliderComparison(false)}
              >
                Side by Side
              </button>
            </div>
          </div>

          {useSliderComparison ? (
            <div className="w-full max-w-2xl mx-auto">
              {/* Simple slider implementation that properly aligns images */}
              <div
                className="relative w-full overflow-hidden rounded-lg shadow-xl select-none"
                style={{ aspectRatio: '1/1' }}
                onMouseMove={handleMouseMove}
                onTouchMove={handleTouchMove}
              >
                {/* Original image in the background */}
                <div className="absolute inset-0">
                  <img
                    src={previewUrl}
                    alt="Original"
                    className="w-full h-full object-cover"
                  />
                </div>

                {/* Optimized image overlay with clip mask based on slider */}
                <div
                  className="absolute inset-0 overflow-hidden"
                  style={{ clipPath: `inset(0 0 0 ${sliderPosition}%)` }}
                >
                  <img
                    src={uploadedUrl}
                    alt="Optimized"
                    className="w-full h-full object-cover"
                  />
                </div>

                {/* Slider divider line */}
                <div
                  className="absolute top-0 bottom-0 w-0.5 bg-white cursor-ew-resize z-10"
                  style={{ left: `${sliderPosition}%` }}
                >
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white shadow-lg z-20 flex items-center justify-center">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M10 8L6 12L10 16M14 8L18 12L14 16" stroke="#333" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                </div>

                {/* Labels */}
                <div className="absolute top-2 left-2 bg-black/50 text-white text-xs px-2 py-1 rounded-md z-10">
                  Original
                </div>
                <div className="absolute top-2 right-2 bg-black/50 text-white text-xs px-2 py-1 rounded-md z-10">
                  Optimized
                </div>
              </div>

              {/* Slider control */}
              <input
                type="range"
                min="1"
                max="99"
                value={sliderPosition}
                onChange={handleSliderChange}
                className="range range-primary w-full mt-4"
              />

              {/* Stats */}
              <div className="flex justify-between items-start mt-4">
                <div className="text-sm">
                  <h4 className="font-semibold">Original</h4>
                  <p>Size: {originalSize ? formatBytes(originalSize) : 'N/A'}</p>
                  <p>Type: {originalFile.type}</p>
                  {originalDimensions && (
                    <p>Dimensions: {originalDimensions.width} × {originalDimensions.height}</p>
                  )}
                  {isHeicConverted && (
                    <div className="badge badge-info mt-1">HEIC converted</div>
                  )}
                </div>
                <div className="text-sm text-right">
                  <h4 className="font-semibold">Optimized</h4>
                  <p>Size: {formatBytes(serverStats.size)}</p>
                  <p>Format: {serverStats.format.toUpperCase()}</p>
                  {serverStats.width > 0 && (
                    <p>Dimensions: {serverStats.width} × {serverStats.height}</p>
                  )}
                  {reductionPercentage() && (
                    <p className="font-semibold text-success">
                      Reduction: {reductionPercentage()}%
                    </p>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col lg:flex-row justify-between gap-4">
              {/* Original Image */}
              <div className="card bg-base-100 shadow-xl flex-1">
                <div className="card-body p-4">
                  <h3 className="card-title text-center">Original Image</h3>
                  {isHeicConverted && (
                    <div className="badge badge-info mb-2">HEIC converted to JPG for preview</div>
                  )}
                  <figure className="flex flex-col items-center">
                    <img
                      src={previewUrl}
                      alt="Original"
                      className="rounded-lg max-h-64 object-contain"
                    />
                  </figure>
                  <div className="text-center mt-2">
                    <p>Size: {originalSize ? formatBytes(originalSize) : 'N/A'}</p>
                    <p>Type: {originalFile.type}</p>
                    {originalDimensions && (
                      <p>Dimensions: {originalDimensions.width} × {originalDimensions.height}</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Optimized Image */}
              <div className="card bg-base-100 shadow-xl flex-1">
                <div className="card-body p-4">
                  <h3 className="card-title text-center">Optimized Image</h3>
                  <figure className="flex flex-col items-center">
                    <img
                      src={uploadedUrl}
                      alt="Optimized"
                      className="rounded-lg max-h-64 object-contain"
                    />
                  </figure>
                  <div className="text-center mt-2">
                    <p>Size: {formatBytes(serverStats.size)}</p>
                    <p>Format: {serverStats.format.toUpperCase()}</p>
                    {serverStats.width > 0 && (
                      <p>Dimensions: {serverStats.width} × {serverStats.height}</p>
                    )}
                    {reductionPercentage() && (
                      <p className="font-semibold text-success">
                        Reduction: {reductionPercentage()}%
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Upload Result - Only show when not processing */}
      {!processingImage && !isUploading && uploadedUrl && (
        <div className="card bg-base-100 shadow-xl my-4 w-full max-w-md">
          <div className="card-body">
            {uploadedUri && (
              <div className="mt-2">
                <div className="text-sm font-medium mb-1">Image ID:</div>
                <div className="flex justify-between items-center">
                  <code className="bg-base-200 p-2 rounded flex-1 overflow-auto">{uploadedUri}</code>
                  <button
                    className="btn btn-sm btn-outline ml-2"
                    onClick={() => copyToClipboard(uploadedUri)}
                  >
                    Copy
                  </button>
                </div>
              </div>
            )}

            <div className="flex justify-center mt-4 gap-2">
              <button
                className="btn btn-outline btn-sm"
                onClick={() => window.open(uploadedUrl, '_blank')}
              >
                Open Image
              </button>
              <button
                className="btn btn-primary btn-sm gap-1"
                onClick={handleDownloadImage}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Download
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast notification */}
      {toast.visible && (
        <div className="toast toast-top toast-end">
          <div className="alert alert-info">
            <span>{toast.message}</span>
          </div>
        </div>
      )}
    </div>
  )
} 