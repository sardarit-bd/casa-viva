import { v2 as cloudinary } from "cloudinary";
import streamifier from "streamifier";

// Cloudinary config (already configured in your app, keep once globally)
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

/**
 * Upload single video
 * @param {Buffer} fileBuffer
 * @param {String} folder
 */
const uploadSingleVideo = (fileBuffer, folder = "videos") => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: "video",
        chunk_size: 6 * 1024 * 1024, // 6MB chunks (recommended for videos)
        eager: [
          {
            format: "mp4",
            quality: "auto",
          },
        ],
      },
      (error, result) => {
        if (error) {
          return reject(
            new Error(`Video upload failed: ${error.message}`)
          );
        }

        resolve({
          url: result.secure_url,
          publicId: result.public_id,
          format: result.format,
          duration: result.duration,
          size: result.bytes,
          width: result.width,
          height: result.height,
        });
      }
    );

    streamifier.createReadStream(fileBuffer).pipe(uploadStream);
  });
};

/**
 * Upload multiple videos
 * @param {Array} files (multer files)
 * @param {String} folder
 */
const uploadMultipleVideos = async (files, folder = "videos") => {
  const uploads = files.map(file =>
    uploadSingleVideo(file.buffer, folder)
  );

  return Promise.all(uploads);
};

/**
 * Delete video
 * @param {String} publicId
 */
const deleteVideo = async (publicId) => {
  try {
    const result = await cloudinary.uploader.destroy(publicId, {
      resource_type: "video",
    });

    return result.result === "ok";
  } catch (error) {
    console.error("Cloudinary video delete error:", error);
    return false;
  }
};

export const videoUploadService = {
  uploadSingleVideo,
  uploadMultipleVideos,
  deleteVideo,
};
