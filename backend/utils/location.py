import sys
import os
import time
import threading

import geocoder
from geopy.geocoders import Nominatim

if sys.platform == "darwin":
    from Foundation import NSObject, NSRunLoop, NSDate
    from CoreLocation import CLLocationManager


class LocationDelegate(NSObject if sys.platform == "darwin" else object):
    location = None
    location_updated_event = None

    def init(self):
        self.location = None
        self.location_updated_event = threading.Event()
        return self

    def locationManager_didUpdateToLocation_fromLocation_(self, manager, newLocation, oldLocation):
        if newLocation is None:
            return
        if oldLocation is None:
            pass
        elif (
            newLocation.coordinate().longitude == oldLocation.coordinate().longitude
            and newLocation.coordinate().latitude == oldLocation.coordinate().latitude
            and newLocation.horizontalAccuracy() == oldLocation.horizontalAccuracy()
        ):
            return

        geolocator = Nominatim(user_agent="UbiLoc")
        self.location = geolocator.reverse(f"{newLocation.coordinate().latitude}, {newLocation.coordinate().longitude}")
        manager.stopUpdatingLocation()
        self.location_updated_event.set()

    def get_location(self):
        if self.location is not None:
            return self.location.address
        else:
            return None

    def locationManager_didFailWithError_(self, manager, error):
        manager.stopUpdatingLocation()
        self.location_updated_event.set()
        raise Exception(f"Error: {error.localizedDescription()}")


def get_current_location_macos():
    try:
        manager = CLLocationManager.alloc().init()
        delegate = LocationDelegate.alloc().init()
        manager.setDelegate_(delegate)
        manager.startUpdatingLocation()

        run_loop = NSRunLoop.currentRunLoop()

        deadline = time.monotonic() + 5
        while not delegate.location_updated_event.is_set() and time.monotonic() < deadline:
            run_loop.runUntilDate_(NSDate.dateWithTimeIntervalSinceNow_(0.1))

        manager.stopUpdatingLocation()
        return delegate.get_location()
    except Exception:
        return None


def get_current_location_based_on_ip():
    g = geocoder.ip('me')
    if g.ok:
        geolocator = Nominatim(user_agent="UbiLoc")
        location = geolocator.reverse(f"{g.lat}, {g.lng}")
        return location.address if location else "Unknown location"
    else:
        return "Unable to determine location via IP."


def get_current_location():
    if os.getenv("CRAFT_LOCATION"):
        return os.environ["CRAFT_LOCATION"]
    # run the below code if the system is macOS
    if sys.platform == "darwin":
        try:
            return get_current_location_macos()
        except Exception as e:
            print(f"Error during macOS location retrieval: {e}")
            return "Location retrieval failed."
    else:
        # use the IP address to get the location
        return get_current_location_based_on_ip()


