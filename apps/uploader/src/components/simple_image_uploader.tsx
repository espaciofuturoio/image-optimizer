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
} from './image_compression_util'

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
    setProcessingImage(true)

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
        } if (headerStr.includes('RIFF') && headerStr.includes('AVI')) {
          throw new Error('Video files cannot be processed. Please upload an image file instead.');
        } if ([0x1A, 0x45, 0xDF, 0xA3].every((val, i) => fileHeader[i] === val)) {
          throw new Error('WebM video files cannot be processed. Please upload an image file instead.');
        }
        throw new Error('File appears to be corrupted or not a valid image format.');

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

      if (url) {
        setUploadedUrl(url);

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
      }

      throw new Error('Upload returned no URL');
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
          if (urlFilename?.includes('.')) {
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
    <div className="flex flex-col items-center p-2 sm:p-4 max-w-5xl mx-auto w-full">
      {/* Container for the entire uploader - card only on larger screens */}
      <div className="w-full bg-base-100 rounded-lg sm:shadow-xl sm:card">
        <div className="p-3 sm:p-6 sm:card-body">
          <h2 className="text-center mx-auto mb-4 sm:mb-6 text-2xl sm:text-3xl font-bold text-primary">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <title>Optimized Image Icon</title>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            Image Optimizer
          </h2>

          {/* File Input with drop zone */}
          <div className="form-control w-full max-w-lg mx-auto">
            <label className="label pb-2 sm:pb-4" htmlFor="file-input">
              <span className="label-text text-base sm:text-lg font-medium flex items-center">
                Choose an image file to compress
              </span>
            </label>
            <label
              className={`flex flex-col items-center justify-center w-full h-24 sm:h-32 px-2 sm:px-4 transition bg-base-200 border-2 border-base-300 border-dashed rounded-lg appearance-none cursor-pointer hover:border-primary hover:bg-base-300 focus:outline-none ${isUploading || processingImage ? 'opacity-60 cursor-not-allowed' : ''}`}
            >
              <div className="flex flex-col items-center justify-center pt-3 pb-4 sm:pt-5 sm:pb-6">
                <svg className="w-6 h-6 sm:w-8 sm:h-8 text-primary mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <title>Upload Icon</title>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <p className="mb-1 text-xs sm:text-sm">
                  <span className="font-semibold">Click to upload</span> or drag and drop
                </p>
                <p className="text-xs text-base-content/70">
                  JPEG, PNG, GIF, WebP, AVIF, HEIC - Max {MAX_FILE_SIZE_MB}MB
                </p>
              </div>
              <input
                type="file"
                id="file-input"
                className="hidden"
                accept={ACCEPTED_FILE_TYPES}
                onChange={handleFileSelect}
                disabled={isUploading || processingImage}
              />
            </label>
          </div>

          {/* Status message area */}
          {uploadStatus.success === false && (
            <div className="alert alert-error my-4 w-full max-w-lg mx-auto shadow-md text-sm sm:text-base">
              <svg xmlns="http://www.w3.org/2000/svg" className="stroke-current shrink-0 h-5 w-5 sm:h-6 sm:w-6" fill="none" viewBox="0 0 24 24"><title>Error Icon</title><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              <span>{uploadStatus.message || 'Upload failed'}</span>
            </div>
          )}

          {/* Enhanced Loading Animation */}
          {(isUploading || processingImage) && (
            <div className="bg-base-200 w-full max-w-lg mx-auto my-4 rounded-lg p-4 sm:p-6 sm:card sm:card-body">
              <div className="flex flex-col items-center w-full">
                <div className="loading loading-spinner loading-lg text-primary mb-3" />
                <h3 className="font-bold text-lg">
                  {isUploading ? 'Optimizing your image...' : 'Processing image...'}
                </h3>
                <p className="text-xs sm:text-sm text-base-content/70 mt-2 max-w-md">
                  {isUploading
                    ? 'Your image is being magically compressed while maintaining quality'
                    : 'Preparing your image for optimal compression'}
                </p>
                <div className="w-full bg-base-300 rounded-full h-2.5 mt-6 overflow-hidden">
                  <div className="bg-primary h-2.5 rounded-full animate-[progress_2s_ease-in-out_infinite]" style={{ width: '75%' }} />
                </div>
              </div>
            </div>
          )}

          {/* Image Comparison - Only show when not processing */}
          {!processingImage && !isUploading && originalFile && previewUrl && uploadedUrl && serverStats && (
            <div className="w-full mt-3 sm:mt-6">
              <div className="divider my-1 sm:my-2">
                <div className="badge badge-primary">Results</div>
              </div>

              {/* Compression stats summary - more compact on mobile */}
              <div className="stats stats-vertical sm:stats-horizontal bg-base-100 shadow mb-3 sm:mb-6 w-full overflow-x-auto text-xs sm:text-sm">
                <div className="stat py-2 sm:py-4">
                  <div className="text-xs sm:text-sm">Original</div>
                  <div className="text-sm sm:text-base">{originalSize ? formatBytes(originalSize) : 'N/A'}</div>
                  <div className="text-xs">{originalFile.type.split('/')[1].toUpperCase()} {originalDimensions && `${originalDimensions.width}×${originalDimensions.height}`}</div>
                </div>

                <div className="stat py-2 sm:py-4">
                  <div className="text-xs sm:text-sm">Optimized</div>
                  <div className="text-sm sm:text-base">{formatBytes(serverStats.size)}</div>
                  <div className="text-xs">{serverStats.format.toUpperCase()} {serverStats.width > 0 && `${serverStats.width}×${serverStats.height}`}</div>
                </div>

                <div className="stat py-2 sm:py-4">
                  <div className="text-xs sm:text-sm">Saved</div>
                  <div className="text-sm sm:text-base text-primary">{reductionPercentage()}%</div>
                  <div className="text-primary text-xs">Smaller file</div>
                </div>
              </div>

              {/* Comparison mode selector - simplified and more touch-friendly */}
              <div className="flex justify-center mb-3 sm:mb-6">
                <div className="join rounded-lg shadow-sm">
                  <button
                    type="button"
                    className={`join-item btn btn-sm sm:btn-md ${useSliderComparison ? 'btn-primary' : 'btn-ghost'}`}
                    onClick={() => setUseSliderComparison(true)}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 sm:h-5 sm:w-5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <title>Slider View</title>
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l4-4 4 4m0 6l-4 4-4-4" />
                    </svg>
                    Slider
                  </button>
                  <button
                    type="button"
                    className={`join-item btn btn-sm sm:btn-md ${!useSliderComparison ? 'btn-primary' : 'btn-ghost'}`}
                    onClick={() => setUseSliderComparison(false)}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 sm:h-5 sm:w-5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <title>Side by Side View</title>
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                    Side by Side
                  </button>
                </div>
              </div>

              {useSliderComparison ? (
                <div className="w-full max-w-4xl mx-auto mb-4">
                  {/* Image comparison with slider */}
                  <div
                    className="relative w-full overflow-hidden rounded-lg shadow-sm sm:shadow-md select-none"
                    style={{
                      aspectRatio: originalDimensions ? `${originalDimensions.width}/${originalDimensions.height}` : '1/1',
                      maxHeight: '60vh'
                    }}
                    onMouseMove={handleMouseMove}
                    onTouchMove={handleTouchMove}
                  >
                    {/* Original image in the background */}
                    <div className="absolute inset-0 bg-base-200 grid place-items-center">
                      <img
                        src={previewUrl}
                        alt="Original"
                        className="w-full h-full object-contain max-h-[60vh]"
                      />
                    </div>

                    {/* Optimized image overlay with clip mask based on slider */}
                    <div
                      className="absolute inset-0 bg-base-200 grid place-items-center overflow-hidden"
                      style={{ clipPath: `inset(0 0 0 ${sliderPosition}%)` }}
                    >
                      <img
                        src={uploadedUrl}
                        alt="Optimized"
                        className="w-full h-full object-contain max-h-[60vh]"
                      />
                    </div>

                    {/* Slider divider line */}
                    <div
                      className="absolute top-0 bottom-0 w-0.5 sm:w-1 bg-primary cursor-ew-resize z-10"
                      style={{ left: `${sliderPosition}%` }}
                    >
                      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-6 h-6 sm:w-8 sm:h-8 rounded-full bg-primary shadow-md z-20 flex items-center justify-center text-primary-content">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <title>Slider Handle</title>
                          <path d="M10 8L6 12L10 16M14 8L18 12L14 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </div>
                    </div>

                    {/* Labels */}
                    <div className="absolute top-1 left-1 sm:top-2 sm:left-2 badge badge-xs sm:badge-sm badge-neutral text-xs z-10">
                      Original
                    </div>
                    <div className="absolute top-1 right-1 sm:top-2 sm:right-2 badge badge-xs sm:badge-sm badge-primary text-xs z-10">
                      Optimized
                    </div>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 sm:gap-4 w-full mb-4">
                  {/* Original Image - simplified on mobile */}
                  <div className="bg-base-200 overflow-hidden rounded-lg">
                    <figure className="px-1 sm:px-2 pt-1 sm:pt-2">
                      <div className="rounded-lg overflow-hidden bg-base-200 w-full"
                        style={{
                          aspectRatio: originalDimensions ? `${originalDimensions.width}/${originalDimensions.height}` : '1/1',
                          minHeight: '120px',
                          maxHeight: '50vh'
                        }}>
                        <img
                          src={previewUrl}
                          alt="Original"
                          className="w-full h-full object-contain max-h-[50vh]"
                        />
                      </div>
                    </figure>
                    <div className="p-1 sm:p-2 text-center">
                      <h3 className="font-medium text-xs sm:text-sm">
                        Original
                      </h3>
                    </div>
                  </div>

                  {/* Optimized Image - simplified on mobile */}
                  <div className="bg-base-200 overflow-hidden rounded-lg">
                    <figure className="px-1 sm:px-2 pt-1 sm:pt-2">
                      <div className="rounded-lg overflow-hidden bg-base-200 w-full"
                        style={{
                          aspectRatio: originalDimensions ? `${originalDimensions.width}/${originalDimensions.height}` : '1/1',
                          minHeight: '120px',
                          maxHeight: '50vh'
                        }}>
                        <img
                          src={uploadedUrl}
                          alt="Optimized"
                          className="w-full h-full object-contain max-h-[50vh]"
                        />
                      </div>
                    </figure>
                    <div className="p-1 sm:p-2 text-center">
                      <h3 className="font-medium text-xs sm:text-sm">
                        Optimized
                      </h3>
                    </div>
                  </div>
                </div>
              )}

              {/* Download and copy section - more compact on mobile */}
              <div className="bg-base-100 shadow-sm sm:shadow-md rounded-lg mb-2 sm:mb-4 w-full">
                <div className="p-2 sm:p-4">
                  <h3 className="text-sm sm:text-base font-medium mb-2">Image URL</h3>
                  <div className="join w-full flex-col sm:flex-row">
                    <input
                      type="text"
                      className="input input-sm sm:input-md input-bordered join-item w-full font-mono text-xs mb-1 sm:mb-0"
                      value={uploadedUrl || ''}
                      readOnly
                    />
                    <button
                      type="button"
                      className="btn btn-sm sm:btn-md join-item btn-primary sm:w-auto w-full"
                      onClick={() => copyToClipboard(uploadedUrl || '')}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <title>Copy Image URL</title>
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                      </svg>
                      Copy
                    </button>
                  </div>

                  <div className="flex justify-end gap-2 mt-3">
                    <button
                      type="button"
                      className="btn btn-sm sm:btn-md btn-outline gap-1"
                      onClick={() => window.open(uploadedUrl, '_blank')}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <title>Open Image</title>
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                      Open
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm sm:btn-md btn-primary gap-1"
                      onClick={handleDownloadImage}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <title>Download</title>
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                      Download
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Toast notification */}
      {toast.visible && (
        <div className="toast toast-top toast-center">
          <div className="alert alert-info shadow-lg max-w-xs sm:max-w-md text-xs sm:text-sm">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" className="stroke-current shrink-0 w-5 h-5 sm:w-6 sm:h-6"><title>Info</title><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            <span>{toast.message}</span>
          </div>
        </div>
      )}

      {/* CSS for transparency background pattern - remove checkerboard and add gradient pattern */}
      <style>
        {`
        .bg-gradient-to-r {
          background-size: 20px 20px;
          background-image: linear-gradient(
            45deg,
            rgba(180, 180, 180, 0.1) 25%,
            transparent 25%,
            transparent 75%,
            rgba(180, 180, 180, 0.1) 75%,
            rgba(180, 180, 180, 0.1)
          );
        }
        
        @keyframes progress {
          0% { width: 0%; }
          50% { width: 75%; }
          100% { width: 100%; }
        }
        `}
      </style>
    </div>
  )
} 
