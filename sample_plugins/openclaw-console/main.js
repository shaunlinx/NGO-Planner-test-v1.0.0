module.exports = {
  activate(api) {
    try {
      api?.log?.('ngo.openclaw.console activated');
    } catch (e) {}
  },
  deactivate() {}
};

