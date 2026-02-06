const companyReadService = require("../services/companyReadService");
const logger = require("../utils/logger");

async function getCompanyById(req, res) {
  const { id } = req.params;

  logger.info("Get company by ID", { company_id: id });

  try {
    const result = await companyReadService.findCompanyById(id);

    if (!result) {
      return res.status(404).json({
        error: "Company not found",
        company_id: id,
      });
    }

    res.json({
      success: true,
      company: result.company,
    });
  } catch (error) {
    logger.error("Error getting company by ID", {
      company_id: id,
      error: error.message,
      stack: error.stack,
    });

    res.status(500).json({
      error: "Failed to get company",
      message: error.message,
    });
  }
}

async function getCompanyByAlias(req, res) {
  const { value } = req.params;

  logger.info("Get company by alias", { alias_value: value });

  try {
    const result = await companyReadService.findCompanyByAlias(value);

    if (!result) {
      return res.status(404).json({
        error: "Company not found",
        alias_value: value,
      });
    }

    res.json({
      success: true,
      company: result.company,
    });
  } catch (error) {
    logger.error("Error getting company by alias", {
      alias_value: value,
      error: error.message,
      stack: error.stack,
    });

    res.status(500).json({
      error: "Failed to get company",
      message: error.message,
    });
  }
}

module.exports = {
  getCompanyById,
  getCompanyByAlias,
};
