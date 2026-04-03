
export const isDesktopApp = (): boolean => {
  // Check for the property exposed by electron/preload.js
  return (window as any).electronAPI?.isDesktop === true;
};
