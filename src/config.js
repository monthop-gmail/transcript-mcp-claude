export const config = {
  PORT: parseInt(process.env.PORT || '3013'),
  HOST: process.env.HOST || '0.0.0.0',
  DEFAULT_LANG: process.env.DEFAULT_LANG || 'th',
  WHISPER_MODEL: process.env.WHISPER_MODEL || 'tiny',
  WHISPER_COMPUTE_TYPE: process.env.WHISPER_COMPUTE_TYPE || 'int8',
  MAX_AUDIO_DURATION: parseInt(process.env.MAX_AUDIO_DURATION || '600'),
  MAX_VDO_DURATION: parseInt(process.env.MAX_VDO_DURATION || '1800'),
  TEMP_DIR: process.env.TEMP_DIR || '/tmp/transcript-mcp',
};
