/* eslint-disable import/first -- jest.mock calls are hoisted above imports; must be textually first too */
jest.mock("expo-device", () => ({ isDevice: true }))
jest.mock("expo-constants", () => ({
  __esModule: true,
  default: { expoConfig: { extra: { eas: { projectId: "test-project-id" } } } },
}))
jest.mock("expo-notifications", () => ({
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getExpoPushTokenAsync: jest.fn(),
  addNotificationResponseReceivedListener: jest.fn(),
}))
jest.mock("../api", () => ({ apiMutate: jest.fn() }))

import * as Device from "expo-device"
import Constants from "expo-constants"
import * as Notifications from "expo-notifications"
import { apiMutate } from "../api"
import { registerForPushNotificationsAsync } from "../push"

const mockedDevice = Device as unknown as { isDevice: boolean }
const mockedNotifications = Notifications as jest.Mocked<typeof Notifications>
const mockedApiMutate = apiMutate as jest.MockedFunction<typeof apiMutate>
const mockedConstants = Constants as unknown as {
  expoConfig?: { extra?: { eas?: { projectId?: string } } }
}

describe("registerForPushNotificationsAsync", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockedDevice.isDevice = true
    mockedConstants.expoConfig = { extra: { eas: { projectId: "test-project-id" } } }
    mockedNotifications.getPermissionsAsync.mockResolvedValue({ status: "granted" } as never)
    mockedNotifications.getExpoPushTokenAsync.mockResolvedValue({ data: "ExponentPushToken[xyz]" } as never)
    mockedApiMutate.mockResolvedValue({} as never)
  })

  it("registers the Expo push token with the backend when permission is already granted", async () => {
    await registerForPushNotificationsAsync()

    expect(mockedNotifications.requestPermissionsAsync).not.toHaveBeenCalled()
    expect(mockedApiMutate).toHaveBeenCalledWith("/api/push/register", {
      method: "POST",
      body: { token: "ExponentPushToken[xyz]", platform: "ios" },
    })
  })

  it("requests permission when not already granted, and registers on approval", async () => {
    mockedNotifications.getPermissionsAsync.mockResolvedValue({ status: "undetermined" } as never)
    mockedNotifications.requestPermissionsAsync.mockResolvedValue({ status: "granted" } as never)
    await registerForPushNotificationsAsync()

    expect(mockedNotifications.requestPermissionsAsync).toHaveBeenCalled()
    expect(mockedApiMutate).toHaveBeenCalled()
  })

  it("does nothing when permission is denied", async () => {
    mockedNotifications.getPermissionsAsync.mockResolvedValue({ status: "undetermined" } as never)
    mockedNotifications.requestPermissionsAsync.mockResolvedValue({ status: "denied" } as never)
    await registerForPushNotificationsAsync()

    expect(mockedApiMutate).not.toHaveBeenCalled()
  })

  it("does nothing on a simulator/emulator (not a physical device)", async () => {
    // Babel's namespace-import interop copies expo-device into a separate wrapper per
    // import site, so mutating the shared mock's `isDevice` property here wouldn't be seen
    // by push.ts's own copy — re-mock the module fresh and re-require push.ts instead.
    jest.resetModules()
    jest.doMock("expo-device", () => ({ isDevice: false }))
    jest.doMock("expo-constants", () => ({
      __esModule: true,
      default: { expoConfig: { extra: { eas: { projectId: "test-project-id" } } } },
    }))
    jest.doMock("expo-notifications", () => ({
      setNotificationHandler: jest.fn(),
      getPermissionsAsync: jest.fn(),
      requestPermissionsAsync: jest.fn(),
      getExpoPushTokenAsync: jest.fn(),
      addNotificationResponseReceivedListener: jest.fn(),
    }))
    jest.doMock("../api", () => ({ apiMutate: jest.fn() }))

    /* eslint-disable @typescript-eslint/no-require-imports -- must re-require after resetModules/doMock above */
    const freshNotifications = require("expo-notifications") as jest.Mocked<typeof Notifications>
    const freshApiMutate = (require("../api") as { apiMutate: jest.Mock }).apiMutate
    const { registerForPushNotificationsAsync: freshRegister } = require("../push")
    /* eslint-enable @typescript-eslint/no-require-imports */
    await freshRegister()

    expect(freshNotifications.getPermissionsAsync).not.toHaveBeenCalled()
    expect(freshApiMutate).not.toHaveBeenCalled()
  })

  it("does nothing when eas build:configure hasn't run yet (no projectId)", async () => {
    mockedConstants.expoConfig = { extra: { eas: { projectId: undefined } } }
    await registerForPushNotificationsAsync()

    expect(mockedNotifications.getExpoPushTokenAsync).not.toHaveBeenCalled()
    expect(mockedApiMutate).not.toHaveBeenCalled()
  })

  it("never throws when the backend registration call fails (e.g. not logged in yet)", async () => {
    mockedApiMutate.mockRejectedValue(new Error("Not authenticated"))
    await expect(registerForPushNotificationsAsync()).resolves.toBeUndefined()
  })
})
