import sharedObjects from "./objects";
import homePage from "./homePage";
import siteSettings from "./siteSettings";

const schemas = [siteSettings, homePage, ...sharedObjects];

export default schemas;

