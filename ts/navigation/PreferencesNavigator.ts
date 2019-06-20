import { createStackNavigator } from "react-navigation";

import ROUTES from "./routes";

import BiometricRecognitionScreen from "../screens/preferences/BiometricRecognitionScreen";
import CalendarsPreferencesScreen from "../screens/preferences/CalendarsPreferencesScreen";
import PreferencesScreen from "../screens/preferences/PreferencesScreen";
import ServiceDetailsScreen from "../screens/preferences/ServiceDetailsScreen";
import ServicesScreen from "../screens/preferences/ServicesScreen";
import ServicesHomeScreen from "../screens/services/ServicesHomeScreen";

const PreferencesNavigator = createStackNavigator(
  {
    [ROUTES.PREFERENCES_HOME]: {
      screen: PreferencesScreen
    },
    [ROUTES.PREFERENCES_SERVICES]: {
      screen: ServicesScreen
    },
    [ROUTES.PREFERENCES_BIOMETRIC_RECOGNITION]: {
      screen: BiometricRecognitionScreen
    },
    [ROUTES.PREFERENCES_CALENDAR]: {
      screen: CalendarsPreferencesScreen
    },
    [ROUTES.PREFERENCES_SERVICE_DETAIL]: {
      screen: ServiceDetailsScreen
    },
    [ROUTES.SERVICES_HOME]: {
      screen: ServicesHomeScreen
    }
  },
  {
    // Let each screen handle the header and navigation
    headerMode: "none"
  }
);

export default PreferencesNavigator;
