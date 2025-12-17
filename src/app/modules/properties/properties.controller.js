import httpStatus from 'http-status-codes';

import { catchAsync } from '../../utils/catchAsync.js';
import { propertiesServices } from './property.service.js';
import { deleteMultipleFromCloudinary, uploadMultipleToCloudinary } from '../../utils/cloudinary.js';
import { pick } from '../../utils/pick.js';

const createProperty = catchAsync(async (req, res) => {
  // Upload images to Cloudinary
  let uploadedImages = [];
  if (req.uploadedFiles && req.uploadedFiles.length > 0) {
    const uploadResults = await uploadMultipleToCloudinary(
      req.uploadedFiles,
      'properties'
    );
    
    uploadedImages = uploadResults.map((result, index) => ({
      url: result.secure_url,
      publicId: result.public_id,
      isCover: index === 0,
      width: result.width,
      height: result.height,
      format: result.format
    }));
  }

  const propertyData = {
    ...req.body,
    images: uploadedImages
  };

  const property = await propertiesServices.createProperty(
    propertyData, 
    req.user._id
  );

  res.status(httpStatus.CREATED).json({
    success: true,
    message: 'Property created successfully',
    data: property
  });
});

const getAllProperties = catchAsync(async (req, res) => {
  const filter = pick(req.query, [
    'search', 'city', 'type', 'listingType', 'minPrice', 
    'maxPrice', 'minBedrooms', 'featured', 'status', 'owner'
  ]);
  
  const paginationOptions = pick(req.query, ['page', 'limit', 'sortBy', 'sortOrder']);
  
  const result = await propertiesServices.getAllProperties(filter, paginationOptions);

  res.status(httpStatus.OK).json({
    success: true,
    message: 'Properties retrieved successfully',
    data: result.properties,
    meta: result.meta
  });
});

const getProperty = catchAsync(async (req, res) => {
  const property = await propertiesServices.getPropertyById(req.params.id);

  res.status(httpStatus.OK).json({
    success: true,
    message: 'Property retrieved successfully',
    data: property
  });
});

const updateProperty = catchAsync(async (req, res) => {
  let updatedImages = null;
  
  // If new images are uploaded
  if (req.uploadedFiles && req.uploadedFiles.length > 0) {
    const uploadResults = await uploadMultipleToCloudinary(
      req.uploadedFiles,
      'properties'
    );
    
    updatedImages = uploadResults.map((result, index) => ({
      url: result.secure_url,
      publicId: result.public_id,
      isCover: index === 0,
      width: result.width,
      height: result.height,
      format: result.format
    }));
  }

  const updateData = {
    ...req.body,
    ...(updatedImages && { images: updatedImages })
  };

  const property = await propertiesServices.updateProperty(
    req.params.id, 
    updateData, 
    req.user._id
  );

  res.status(httpStatus.OK).json({
    success: true,
    message: 'Property updated successfully',
    data: property
  });
});

const deleteProperty = catchAsync(async (req, res) => {
  const permanent = req.query.permanent === 'true';
  
  const property = await propertiesServices.deleteProperty(
    req.params.id, 
    req.user._id,
    permanent
  );

  // If permanent delete and property had images, delete from Cloudinary
  if (permanent && property.images && property.images.length > 0) {
    const publicIds = property.images.map(img => img.publicId).filter(Boolean);
    if (publicIds.length > 0) {
      await deleteMultipleFromCloudinary(publicIds);
    }
  }

  res.status(httpStatus.OK).json({
    success: true,
    message: permanent ? 'Property permanently deleted' : 'Property moved to trash',
    data: null
  });
});

const getMyProperties = catchAsync(async (req, res) => {
  const filter = pick(req.query, [
    'search', 'city', 'type', 'listingType', 'minPrice', 
    'maxPrice', 'minBedrooms', 'featured', 'status'
  ]);
  
  const paginationOptions = pick(req.query, ['page', 'limit', 'sortBy', 'sortOrder']);
  
  const result = await propertiesServices.getMyProperties(
    req.user._id, 
    filter, 
    paginationOptions
  );

  res.status(httpStatus.OK).json({
    success: true,
    message: 'Your properties retrieved successfully',
    data: result.properties,
    meta: result.meta
  });
});

const toggleFeatured = catchAsync(async (req, res) => {
  const { featured } = req.body;
  
  const property = await propertiesServices.toggleFeatured(
    req.params.id,
    req.user._id,
    featured
  );

  res.status(httpStatus.OK).json({
    success: true,
    message: `Property ${featured ? 'marked as featured' : 'removed from featured'}`,
    data: property
  });
});

const updateStatus = catchAsync(async (req, res) => {
  const { status } = req.body;
  
  const property = await propertiesServices.updateStatus(
    req.params.id,
    req.user._id,
    status
  );

  res.status(httpStatus.OK).json({
    success: true,
    message: `Property status updated to ${status}`,
    data: property
  });
});

const getPropertyStats = catchAsync(async (req, res) => {
  const stats = await propertiesServices.getPropertyStats(req.user._id);

  res.status(httpStatus.OK).json({
    success: true,
    message: 'Property statistics retrieved successfully',
    data: stats
  });
});

const restoreProperty = catchAsync(async (req, res) => {
  const property = await propertiesServices.updateProperty(
    req.params.id,
    { 
      isDeleted: false, 
      deletedAt: null, 
      status: 'active' 
    },
    req.user._id
  );

  res.status(httpStatus.OK).json({
    success: true,
    message: 'Property restored successfully',
    data: property
  });
});

const getTrashedProperties = catchAsync(async (req, res) => {
  const filter = pick(req.query, [
    'search', 'city', 'type', 'listingType'
  ]);
  
  const paginationOptions = pick(req.query, ['page', 'limit', 'sortBy', 'sortOrder']);
  
  // Override filter to only show deleted properties
  filter.isDeleted = true;
  filter.owner = req.user._id;
  
  const result = await propertiesServices.getAllProperties(filter, paginationOptions);

  res.status(httpStatus.OK).json({
    success: true,
    message: 'Trashed properties retrieved successfully',
    data: result.properties,
    meta: result.meta
  });
});

export const propertiesControllers = {
  createProperty,
  getAllProperties,
  getProperty,
  updateProperty,
  deleteProperty,
  getMyProperties,
  toggleFeatured,
  updateStatus,
  getPropertyStats,
  restoreProperty,
  getTrashedProperties
};