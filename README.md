# Spotify-Queue-Display
A simple app to display the currently playing and next few queued songs from Spotify. Displays as a floating widget that can sit above full-screen apps on Windows and MacOS.

## Configuration
All the app configuration is held in appconfig.json. You will need a Spotify developer account, and will also need to have created an app on the developer dashboard.
The redirect URI should be set to ```http://localhost:3000/callback```. APIs used are Web Playback SDK and WebAPI. You'll also need to grant access for any spotify users who want to use the app.

You will also need to create a .env file with the following structure and place it in the root of the project folder before building.
```
SPOTIFY_CLIENT_ID=yourspotifyclientidgoeshere
SPOTIFY_CLIENT_SECRET=yourspotifyclientsecretgoeshere
```
## Testing and Building
The following command will test the app locally, installing all dependencies. You will need the latest version of Node.JS installed.
```
npm run electron
```

You can package it into a self-installing standalone app using the command:
```
npm run build
```
This utilises electron-build, and by default will build for the platform you run it on (e.g. a Windows executable if run on Windows, .dmg if run on MacOS, etc.)
More information can be found in the [electron-builder wiki](https://www.electron.build/index.html)

## App function
The app will start a node.js web server in the background when launched, and once that is running will launch a login process to verify that the app has permission to access the user's spotify account.
This initial handshake should only need to be done once per machine.

## Known issues
### Build issues
- The .env file contents don't seem to be included when the app is built, resulting in the app not working. A work-around is to hard-code the clientID and client secret in main.cjs and appserver.cjs in place of the environment variable reference, prior to build. Just don't sync it back to Github!
- After building (at least on MacOS), the app launches, but the web server component doesn't seem to for some reason. Since the whole thing is essentially a web-app this is kind of a show stopper. Will need more research to fix.

### Runtime issues
- You will need have Spotify actively playing a song in a playlist _before_ you launch the app, otherwise it will display an error message inside the app window and won't refresh until you relaunch the app.
