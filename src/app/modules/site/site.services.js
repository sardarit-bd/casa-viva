import Site from './site.model.js';

const updateSite = async (payload) => {
  const site = await Site.findOneAndUpdate(
    {},            
    { $set: payload }, 
    { new: true, upsert: true }
  );

  return site;
};



const getMySite = async () => {
  return Site.find()
};

export const siteServices = {
  getMySite,
  updateSite
};