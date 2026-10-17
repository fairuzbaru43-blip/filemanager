const { AccessError, ConfigurationError, InvalidInputError } = require("./configuration");

function sendDriveError(res, error, genericMessage, logMessage) {
  if (error instanceof ConfigurationError) return res.status(503).json({ error: error.message });
  if (error instanceof InvalidInputError) return res.status(400).json({ error: error.message });
  if (error instanceof AccessError) return res.status(403).json({ error: error.message });
  console.error(logMessage);
  return res.status(500).json({ error: genericMessage });
}

module.exports = { sendDriveError };
