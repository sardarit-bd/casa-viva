import httpStatus from 'http-status-codes';
import Blog from './blog.model.js';
import AppError from '../../errorHelpers/AppError.js';
import mongoose from 'mongoose';

const createBlog = async (payload, userId) => {
  // Check if blog with same title exists for this author
  const existingBlog = await Blog.findOne({
    title: payload.title,
    author: userId,
    isDeleted: false
  });

  if (existingBlog) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      'You already have a blog post with this title'
    );
  }

  // Create blog
  const blog = await Blog.create({
    ...payload,
    author: userId
  });

  return blog;
};

const getAllBlogs = async (filters, paginationOptions) => {
  const { search, category, status, author, isDeleted } = filters;
  const { page, limit, sortBy, sortOrder } = paginationOptions;

  const query = { isDeleted: false };

  if (isDeleted) {
    query.isDeleted = true;
  }

  // Search by title, content, or excerpt
  if (search) {
    query.$or = [
      { title: { $regex: search, $options: 'i' } },
      { content: { $regex: search, $options: 'i' } },
      { excerpt: { $regex: search, $options: 'i' } }
    ];
  }

  // Filter by category
  if (category) {
    query.category = category;
  }

  // Filter by status
  if (status) {
    query.status = status;
  }

  // Filter by author
  if (author) {
    query.author = author;
  }

  // Pagination
  const pageNum = Number(page) || 1;
  const limitNum = Number(limit) || 10;
  const skip = (pageNum - 1) * limitNum;

  // Sorting
  const sortConditions = {};
  if (sortBy && sortOrder) {
    sortConditions[sortBy] = sortOrder === 'desc' ? -1 : 1;
  } else {
    sortConditions.createdAt = -1; // Default sort by newest
  }

  const blogs = await Blog.find(query)
    .populate('author', 'name email avatar')
    .sort(sortConditions)
    .skip(skip)
    .limit(limitNum)
    .lean();

  const total = await Blog.countDocuments(query);

  return {
    blogs,
    meta: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.ceil(total / limitNum)
    }
  };
};

const getBlogById = async (id) => {
  const blog = await Blog.findById(id)
    .populate('author', 'name email avatar')
    .lean();

  if (!blog || blog.isDeleted) {
    throw new AppError(httpStatus.NOT_FOUND, 'Blog post not found');
  }

  return blog;
};

const updateBlog = async (id, payload, userId) => {
  const blog = await Blog.findById(id);

  if (!blog || blog.isDeleted) {
    throw new AppError(httpStatus.NOT_FOUND, 'Blog post not found');
  }

  // Check ownership
  if (blog.author.toString() !== userId.toString()) {
    throw new AppError(httpStatus.FORBIDDEN, 'You are not authorized to update this blog post');
  }

  Object.assign(blog, payload);
  await blog.save();

  return blog;
};

const deleteBlog = async (id, userId, permanent = false) => {
  const blog = await Blog.findById(id);

  if (!blog || (blog.isDeleted && !permanent)) {
    throw new AppError(httpStatus.NOT_FOUND, 'Blog post not found');
  }

  // Check ownership
  if (blog.author.toString() !== userId.toString()) {
    throw new AppError(httpStatus.FORBIDDEN, 'You are not authorized to delete this blog post');
  }

  if (permanent) {
    await Blog.findByIdAndDelete(id);
  } else {
    // Soft delete
    blog.isDeleted = true;
    blog.deletedAt = new Date();
    blog.status = 'draft';
    await blog.save();
  }

  return blog;
};

const getMyBlogs = async (userId, filters, paginationOptions) => {
  return getAllBlogs(
    { ...filters, author: userId },
    paginationOptions
  );
};

const updateStatus = async (id, userId, status) => {
  const blog = await Blog.findById(id);

  if (!blog || blog.isDeleted) {
    throw new AppError(httpStatus.NOT_FOUND, 'Blog post not found');
  }

  // Check ownership
  if (blog.author.toString() !== userId.toString()) {
    throw new AppError(httpStatus.FORBIDDEN, 'You are not authorized to modify this blog post');
  }

  blog.status = status;
  await blog.save();

  return blog;
};

const getBlogStats = async (userId) => {
  const stats = await Blog.aggregate([
    {
      $match: {
        author: new mongoose.Types.ObjectId(userId),
        isDeleted: false
      }
    },
    {
      $group: {
        _id: null,
        totalBlogs: { $sum: 1 },
        totalPublished: {
          $sum: { $cond: [{ $eq: ['$status', 'published'] }, 1, 0] }
        },
        totalDrafts: {
          $sum: { $cond: [{ $eq: ['$status', 'draft'] }, 1, 0] }
        }
      }
    },
    {
      $project: {
        _id: 0,
        totalBlogs: 1,
        totalPublished: 1,
        totalDrafts: 1
      }
    }
  ]);

  return stats[0] || {
    totalBlogs: 0,
    totalPublished: 0,
    totalDrafts: 0
  };
};

export const blogServices = {
  createBlog,
  getAllBlogs,
  getBlogById,
  updateBlog,
  deleteBlog,
  getMyBlogs,
  updateStatus,
  getBlogStats
};