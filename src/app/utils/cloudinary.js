import { v2 as cloudinary } from 'cloudinary';
import streamifier from 'streamifier';
import httpStatus from 'http-status-codes';
import AppError from '../errorHelpers/AppError.js';

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
});

/**
 * Upload file buffer to Cloudinary
 * @param {Buffer} fileBuffer - File buffer
 * @param {string} folder - Cloudinary folder
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} Upload result
 */
const uploadToCloudinary = (fileBuffer, folder = 'properties', options = {}) => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: 'auto',
        ...options
      },
      (error, result) => {
        if (error) {
          reject(new AppError(
            httpStatus.INTERNAL_SERVER_ERROR,
            'Failed to upload file to Cloudinary'
          ));
        } else {
          resolve(result);
        }
      }
    );

    streamifier.createReadStream(fileBuffer).pipe(uploadStream);
  });
};

/**
 * Upload multiple files to Cloudinary
 * @param {Array} files - Array of file buffers
 * @param {string} folder - Cloudinary folder
 * @returns {Promise<Array>} Array of upload results
 */
const uploadMultipleToCloudinary = async (files, folder = 'properties') => {
  try {
    const uploadPromises = files.map(file => 
      uploadToCloudinary(file.buffer, folder, {
        public_id: `${Date.now()}-${Math.round(Math.random() * 1E9)}`,
        transformation: [
          { width: 1200, height: 800, crop: 'limit' },
          { quality: 'auto:good' }
        ]
      })
    );

    return await Promise.all(uploadPromises);
  } catch (error) {
    throw new AppError(
      httpStatus.INTERNAL_SERVER_ERROR,
      'Failed to upload multiple files'
    );
  }
};

/**
 * Delete file from Cloudinary
 * @param {string} publicId - Cloudinary public ID
 * @returns {Promise<Object>} Delete result
 */
const deleteFromCloudinary = async (publicId) => {
  try {
    if (!publicId) return null;
    
    const result = await cloudinary.uploader.destroy(publicId);
    
    if (result.result !== 'ok') {
      console.warn(`Failed to delete file from Cloudinary: ${publicId}`);
    }
    
    return result;
  } catch (error) {
    console.error('Error deleting from Cloudinary:', error);
    // Don't throw error for deletion failures
    return null;
  }
};

/**
 * Delete multiple files from Cloudinary
 * @param {Array} publicIds - Array of public IDs
 * @returns {Promise<Array>} Array of delete results
 */
const deleteMultipleFromCloudinary = async (publicIds) => {
  try {
    const deletePromises = publicIds.map(publicId => 
      deleteFromCloudinary(publicId)
    );
    
    return await Promise.all(deletePromises);
  } catch (error) {
    console.error('Error deleting multiple files:', error);
    return [];
  }
};

/**
 * Optimize image URL with transformations
 * @param {string} url - Original Cloudinary URL
 * @param {Object} options - Transformation options
 * @returns {string} Optimized URL
 */
const optimizeImageUrl = (url, options = {}) => {
  if (!url || !url.includes('cloudinary.com')) return url;
  
  const {
    width = 800,
    height = 600,
    quality = 'auto',
    crop = 'fill',
    format = 'auto'
  } = options;

  // Parse the Cloudinary URL
  const parts = url.split('/upload/');
  if (parts.length !== 2) return url;

  // Add transformations
  const transformations = [
    `w_${width}`,
    `h_${height}`,
    `c_${crop}`,
    `q_${quality}`,
    `f_${format}`
  ].join(',');

  return `${parts[0]}/upload/${transformations}/${parts[1]}`;
};

/**
 * Generate responsive image srcset
 * @param {string} url - Original Cloudinary URL
 * @param {Array} breakpoints - Array of widths
 * @returns {string} srcset string
 */
const generateSrcset = (url, breakpoints = [400, 800, 1200, 1600]) => {
  if (!url || !url.includes('cloudinary.com')) return '';

  const srcset = breakpoints.map(width => {
    const optimizedUrl = optimizeImageUrl(url, { width, height: Math.round(width * 0.75) });
    return `${optimizedUrl} ${width}w`;
  });

  return srcset.join(', ');
};

export {
  uploadToCloudinary,
  uploadMultipleToCloudinary,
  deleteFromCloudinary,
  deleteMultipleFromCloudinary,
  optimizeImageUrl,
  generateSrcset
};