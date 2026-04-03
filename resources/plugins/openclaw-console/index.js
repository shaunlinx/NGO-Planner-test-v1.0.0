module.exports = {
  activate(api) {
    try {
      api?.log?.('OpenClaw console plugin activated');
    } catch (e) {}
  }
};

