// ==== SET UP EXTERNAL REFERENCE MODULES ====
require('dotenv').config(); //allows storing sensitive strings like API keys in .env file to be excluded from github.
const express = require('express');
const net = require('net');
const SpotifyWebApi = require('spotify-web-api-node');
const axios = require('axios');
const expressApp = express(); //made global so it's accessible inside loadConfig();
const path = require('path');
const fs = require('fs');

// ==== SET UP CONFIG FILE PATH =====
function loadConfig() {
  const configFile = "appconfig.json";
  const configPath = path.join(__dirname, configFile); // __dirname for relative path instead of hard-coded location

  // ==== READ CONFIG FILE AND ASSIGN VALUES ====
  // Read the CONFIG file - config.json
  console.log(`appserver.cjs > config file path ${configPath}`);
  console.log(`config file path ${configPath}`);

  let config;
  try {
    config = JSON.parse(fs.readFileSync(configPath), 'utf8');

    // Replace variables in appconfig with actual environment variables
    config.spotifyClientId = process.env.SPOTIFY_CLIENT_ID;
    config.spotifyClientSecret = process.env.SPOTIFY_CLIENT_SECRET;
    log.info('appserver.cjs > SPOTIFY_CLIENT_ID:', process.env.SPOTIFY_CLIENT_ID);
    log.info('appserver.cjs > SPOTIFY_CLIENT_SECRET:', process.env.SPOTIFY_CLIENT_SECRET);

    if(!config.spotifyClientId || !config.spotifyClientSecret) {
      log.error('Environment variables containing the Spotify Client ID and API key are missing. Unable to start.');
      throw error;
    }
  } catch (error) {
      log.error(`appserver.cjs > Failed to read ${configPath}`, error);
      throw error; // Let main.cjs handle the quit logic
      //expressApp.quit(); //Apparently this isn't a function of express, at least according to ChatGPT.
  }

  return config;
}

// ==== SET UP LOGGING TO A FILE ====
// Redirect console.log to use electron-log
const log = require('electron-log');
console.log = log.info;
console.error = log.error;
console.warn = log.warn;
console.debug = log.debug;
console.silly = log.silly;

console.log(`****** SERVER STARTING FOR DISPLAY SONGS QUEUE ******`);


// Assign the config values
const appConfig = loadConfig();

const port = appConfig.port || 3000; // Default to 3000 if not specified
const pageRefreshMs = appConfig.pageRefreshMs || 10000; // Default 10,000ms = 10sec
const fontFamily = appConfig.fontFamily || "'Roboto', sans-serif";
let backGroundColor = appConfig.backGroundColor || "rgba(255, 255, 255, .5)"; // white opacity 50%

const nbrTracks = appConfig.nbrTracks || 5;
let statusCode = 0;

let addAudioFeatures = appConfig.addAudioFeatures.toLowerCase() === 'true';
let addGenre = appConfig.addGenre.toLowerCase() === 'true';
const displayTime = appConfig.showTime.toLowerCase() === 'true';
let displayBPM = appConfig.BPM.toLowerCase() === 'true';
let displayEnergy = appConfig.energy.toLowerCase() === 'true';
let displayDanceability = appConfig.danceability.toLowerCase() === 'true';
let displayHappiness = appConfig.happiness.toLowerCase() === 'true';
let displayGenres = appConfig.genres.toLowerCase() === 'true';

if (!addAudioFeatures && displayBPM && displayEnergy && displayDanceability && displayHappiness) {
  addAudioFeatures = false;
}
if (!addGenre & displayGenres) {
  addGenre = false;
}

// Set global variables
let playing = "";
// Variables to cache the last known playback state and queue
let cachedCurrentlyPlaying = null;
let cachedcurrentlyPlayingPlaylist = null;
let cachedQueue = [];
let cachedPlaybackState = null;
let cachedPlaylistId = '';
let albumImage = '';

let cachedBpmList = [];
let cachedEnergyList = [];
let cachedDanceabilityList = [];
let cachedValenceList = [];
let cachedGenresList = [];

let playlistTrackIds = [];

// ==== SETUP CONNECTION TO SPOTIFY ====
// Spotify API credentials
const spotifyApi = new SpotifyWebApi({
    clientId: appConfig.spotifyClientId,
    clientSecret: appConfig.spotifyClientSecret,
    redirectUri: `http://localhost:${port}/callback`
  });
  
// Store tokens and expiration time
let accessToken = '';
let refreshToken = '';
let tokenExpiration = Date.now(); // Token expiration timestamp


// Serve static files (for HTML and other assets)
expressApp.use(express.static('public'));


// ==== MIDDLEWARE PROCESSING ====
// Middleware to ensure the token is valid before making API requests
const ensureValidToken = async (req, res, next) => {
    const now = Date.now();
  
    const currentDate = new Date(now);
    const expirationDate = new Date(tokenExpiration);
    
    const readableNow = currentDate.toLocaleString();
    const readableExpiration = expirationDate.toLocaleString();
    
    console.log(`appserver.cjs > Token - Current Date and Time: ${readableNow}`);
    console.log(`appserver.cjs > Token - Token Expiration Date and Time: ${readableExpiration}`);
    
    if (Date.now() > tokenExpiration) {
        console.log("Token has expired.");
        await refreshAccessToken();
    } else {
        console.log("Token is still valid.");
    }
    next();
  };


// ==== STEP 1: INITIATE THE AUTHENTICATION PROCESS ====
// Endpoint to start the authentication process
expressApp.get('/login', (req, res) => {
  const scopes = ['user-read-private', 'user-read-email', 'user-read-playback-state', 'user-read-currently-playing'];
  const authorizeURL = spotifyApi.createAuthorizeURL(scopes);
  console.log('appserver.cjs expressApp.get(/login)');
  res.redirect(authorizeURL);
});


// ==== STEP 2: CALLBACK RECEIVES AUTHORIZATION CODE ====
// Endpoint to handle the callback from Spotify
expressApp.get('/callback', async (req, res) => {
  const { code } = req.query;
  console.log('appserver.cjs > expressApp.get(/callback)');
  try {
    const data = await spotifyApi.authorizationCodeGrant(code);
    accessToken = data.body.access_token;
    refreshToken = data.body.refresh_token;
    tokenExpiration = Date.now() + (data.body.expires_in - 60) * 1000; // Set expiration time 60 seconds before the token actually expires

    // Set the access token and refresh token on the API object
    spotifyApi.setAccessToken(accessToken);
    spotifyApi.setRefreshToken(refreshToken);

    res.redirect('/queue');
  } catch (error) {
    log.error('Error during authorization code grant:', error);
    res.send(`Error: ${error.message}`);
  }
});

// ==== STEP 3: ACCESS AND DISPLAY THE QUEUE ====
// Endpoint to fetch the current playback state and queue, and render the HTML page
expressApp.get('/queue', ensureValidToken, async (req, res) => {
  try {
    console.log('appserver.cjs > expressApp.get(/queue)');
    let playbackTrackName = '';
    let playbackTrackId = '';
    let playbackArtists = [];
    let playbackDuration = 0
    let playbackProgress_ms = 0;
    let waitForRefresh = pageRefreshMs;  // set the page refresh time.  when song playing refresh at start of next song. On pause default to config parameter
    
    let currentlyPlaying = null;
    let currentlyPlayingPlaylist = [];
    let queueFeaturesList = [];
    let queueGenresList = [];
    let queue = [];
    let bpmList = [];
    let energyList = [];
    let danceabilityList = [];
    let valenceList = [];
    let genresList = [];

    let HTMLpage = '';

    let playbackState = await spotifyApi.getMyCurrentPlaybackState();
    statusCode = playbackState.statusCode;
    const isPlaying = playbackState.body && playbackState.body.is_playing; // Check if track is playing
    if (statusCode === 200) {
      if (isPlaying) {
        console.log('Spotify is available and playing a song.')   

      } else {
        console.log('Spotify is available and a song is paused.')           
      }
      // Get album images
      albumImage = playbackState.body.item.album.images[1].url;
      //console.error(JSON.stringify(playbackState.body.item.album.images[2].url, null, 2));

      // Check if the currently playing track is part of a playlist
      if (playbackState.body.context && playbackState.body.context.type === 'playlist') {
        const playlistUri = playbackState.body.context.uri;
        const playlistId = playlistUri.split(':').pop();
        //let playlistResponse = [];

        if (cachedcurrentlyPlayingPlaylist && cachedcurrentlyPlayingPlaylist.length === 0) {
          console.log('The array is empty.');
          // Fetch the playlist details
          try {
            // Wait for the playlist to be fetched
            const playlistResponse = await spotifyApi.getPlaylist(playlistId);
      
            // Access the playlist body safely
            if (playlistResponse && playlistResponse.body) {
              currentlyPlayingPlaylist = playlistResponse.body;
              cachedcurrentlyPlayingPlaylist = currentlyPlayingPlaylist;
              cachedPlaylistId = playlistId;
      
              // Check if tracks are available before mapping
              if (playlistResponse.body.tracks && playlistResponse.body.tracks.items) {
                  playlistTrackIds = playlistResponse.body.tracks.items.map(item => item.track.id);
              } else {
                  console.error('No tracks found in the playlist.');
              }
            } else {
              console.error('Playlist body is undefined.');
            }
          } catch (error) {
            console.error('Error fetching playlist:', error);
          }

        } else if (cachedcurrentlyPlayingPlaylist && cachedcurrentlyPlayingPlaylist.length > 0) {
          console.log('The array is not empty.');
        } else {
          //console.log(`The array is null or undefined. ${playlistId}`); //Is it though?
          // Fetch the playlist details
          try {
            // Wait for the playlist to be fetched
            const playlistResponse = await spotifyApi.getPlaylist(playlistId);
      
            // Access the playlist body safely
            if (playlistResponse && playlistResponse.body) {
              currentlyPlayingPlaylist = playlistResponse.body;
              cachedcurrentlyPlayingPlaylist = currentlyPlayingPlaylist;
              cachedPlaylistId = playlistId;
      
              // Check if tracks are available before mapping
              if (playlistResponse.body.tracks && playlistResponse.body.tracks.items) {
                  playlistTrackIds = playlistResponse.body.tracks.items.map(item => item.track.id);
              } else {
                  console.error('No tracks found in the playlist.');
              }
            } else {
              console.error('Playlist body is undefined.');
            }
          } catch (error) {
            console.error('Error fetching playlist:', error);
          }
        }

        if (!cachedPlaylistId === playlistId) {
          console.error(`Playlist changed - ${cachedPlaylistId} and ${playlistId}`)
          // Fetch the new playlist details
          playlistResponse = await spotifyApi.getPlaylist(playlistId);
          currentlyPlayingPlaylist = playlistResponse.body;
          cachedcurrentlyPlayingPlaylist = currentlyPlayingPlaylist;
          cachedPlaylistId = playlistId;
        }
      }

      if (isPlaying) {
        playing = "Playing";

        playbackTrackName = playbackState.body.item.name;
        playbackTrackId = playbackState.body.item.id;
        playbackArtists = playbackState.body.item.artists;
        playbackProgress_ms = playbackState.body.progress_ms;
        playbackDuration = playbackState.body.item.duration_ms;
        // Calculate the total time left in the song
        // timeLeft = playbackDuration - playbackProgress_ms;
        waitForRefresh = playbackDuration - playbackProgress_ms

        currentlyPlaying = playbackState.body.item;

        // Cache the currently playing track and playback state
        cachedCurrentlyPlaying = currentlyPlaying;
        cachedPlaybackState = playbackState;

        // Request for the playback queue
        const queueData = await axios.get('https://api.spotify.com/v1/me/player/queue', {
          headers: {
          'Authorization': `Bearer ${accessToken}`
          }
        });

        queue = queueData.data.queue.slice(0, appConfig.nbrTracks); // Get the next 5 songs from the queue
        cachedQueue = queue;
        // Get track ids for the next 5 songs in the queue
        const trackIds = queue.map(track => track.id);
    
        if (addAudioFeatures) {
          // Get audio features for the currently playing track
          const audioFeatures = await getTrackAudioFeatures(currentlyPlaying.id);

          if (audioFeatures) { // Check if audioFeatures is not null
            // Add the currently playing track's features to the lists
            bpmList.push(audioFeatures.tempo); // 'tempo' is already rounded in the function
            energyList.push(audioFeatures.energy);
            danceabilityList.push(audioFeatures.danceability);
            valenceList.push(audioFeatures.valence);

            // Get audio features for the next 5 songs in the queue
            queueFeaturesList = await getTracksFeatures(trackIds);
            bpmList = [...bpmList, ...queueFeaturesList.map(f => f.tempo)];
            energyList = [...energyList, ...queueFeaturesList.map(f => f.energy)];
            danceabilityList = [...danceabilityList, ...queueFeaturesList.map(f => f.danceability)];
            valenceList = [...valenceList, ...queueFeaturesList.map(f => f.valence)];

            cachedBpmList = bpmList;
            cachedEnergyList = energyList;
            achedDanceabilityList = danceabilityList;
            cachedValenceList = valenceList;    
          } else {
          console.error('appserver.cjs Error: No audio features found for the track.');
          }
        }

        if (addGenre){
          // Get genres from the currently playing track's artists
          const artistGenres = await getArtistGenres(currentlyPlaying.artists.map(artist => artist.id));
          const genres = artistGenres.length ? artistGenres.flatMap(genre => genre.genres).join(', ') : 'Unknown';
          genresList.push(genres);

          // Get genres for the next 5 songs in the queue
          queueGenresList = await getTracksGenres(queue);
          genresList = [...genresList, ...queueGenresList];

          cachedGenresList = genresList; 
        }

        // Check if track in the queue are in the Playlist
        const matchingTracks = [];
        const queueTrackIds = queue.map(item => item.id);
        // console.error(JSON.stringify(playlistTrackIds, null, 2));

        // Iterate through each track ID in the queue
        queueTrackIds.forEach(queueTrackId => {
          // Check if the current queue track ID exists in the playlist
          const isMatch = playlistTrackIds.some(playlistTrackId => playlistTrackId === queueTrackId);

          // If a match is found, add it to the matchingTracks array
          if (isMatch) {
          matchingTracks.push(queueTrackId);
          }
        });

        if (matchingTracks.length === 0) {
          // clear the queue list as likely that reached end of playlist
          queue = [];
          cachedQueue = [];
        }
      } else {
        console.log('Song PAUSED');
        playing = "Paused";

        // Use cached data when playback is paused
        currentlyPlaying = cachedCurrentlyPlaying;
        currentlyPlayingPlaylist = cachedcurrentlyPlayingPlaylist;
        playbackState = cachedPlaybackState;
        queue = cachedQueue; 
    
        bpmList = cachedBpmList;
        energyList = cachedEnergyList;
        danceabilityList =cachedDanceabilityList;
        valenceList = cachedValenceList;
        genresList = cachedGenresList;   

        waitForRefresh = pageRefreshMs;
      }
      backGroundColor = appConfig.backGroundColor;
    } else {
        if (statusCode === 204) {
          console.error('Spotify is not available. Either start spotify or resume playback.'); 
          backGroundColor = appConfig.errorBackGroundColor;
        } else {
          console.error('Unexpected Error', err); 
          backGroundColor = appConfig.errorBackGroundColor;         
        }
    }

    // Convert decimals to be out of 100 and round to 0 decimals
    energyList = energyList.map(value => Math.round(value * 100));
    danceabilityList = danceabilityList.map(value => Math.round(value * 100));
    valenceList = valenceList.map(value => Math.round(value * 100));

    const styles = `
        <style>
        body, html {
          margin: 0;
          padding: 0;
          background-color: rgba(250, 250, 250, 1);
          font-family: ${fontFamily};
          overflow: hidden;
        }

        body{
            font-family: ${fontFamily};
            -webkit-app-region: drag;
            backdrop-filter: blur(10px);
        }    

        .background {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background-color: ${backGroundColor}; /* Default background */
        }

        .container-wrapper {
          display: inline-block;
          padding: 10px;
          border-radius: 10px;
          background-color: ${backGroundColor}; /* Default background */
        }

        .container {
          position: relative;
          padding: 20px;
          border: 1px solid ${appConfig.borderColor};
          margin: 10px;
          max-width: 500px; /* Limit the maximum width of the entire container */
          margin: 0 auto; /* Center the container */
          background-color: transparent;
        }
    
        /* Currently Playing Section */
        .header {
          text-align: center;
          color: ${appConfig.headerColor};
          padding: 1px;
          margin: 1px;
          margin-block-start: 0; margin-block-end: 0;
        }

        .currently-playing {
          display: flex;
          align-items: center;
          margin-bottom: 20px;

        }
    
        .currently-playing img {
          width: 60px;
          height: 60px;
          margin-right: 20px;
        }
    
        .currently-playing .info {
          font-size: 16px;
        }
    
        .currently-playing .info .song-title {
          font-size: 18px;
          font-weight: bold;
        }
    
        /* Progress Bar Section */
        .progress-container {
          display: flex;
          align-items: center;
          margin-top: 10px;
        }
    
        #progress-bar {
          width: 100%; /* Ensure the bar takes up full width of its container */
          height: 10px;
          border-radius: 5px;
          overflow: hidden;
          position: relative;
          background-color: ${appConfig.progressBarColor};
        }
    
        #progress {
          height: 100%;
          width: 50%; /* Default to 50% for now */
          border-radius: 5px;
          background-color: ${appConfig.progressColor};
        }
    
        .time {
          font-size: 14px;
          margin: 0 10px;
        }
    
        /* Queue Section */
        .queue-container {
          margin-top: 30px;
        }
    
        .queue-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 10px;
          border-bottom: 1px solid ${appConfig.borderColor};
        }
    
        .queue-item h2 {
          font-size: 16px;
          margin: 0;
        }
    
        .queue-item p {
          font-size: 14px;
          margin: 0;
        }
    
        .queue-item .song-info {
          flex-grow: 1;
          margin-right: 10px;
        }
    
        .queue-item .duration {
          white-space: nowrap;
        }
      </style>
    `;

    const scripts = `
        <script>
        // Function to refresh the page every 10 seconds
            function refreshPage() {
            setTimeout(function(){
              location.reload();
            }, ${waitForRefresh}); // 10000 milliseconds = 10 seconds
          }
  
          // Call the function when the page loads
        window.onload = refreshPage;
      </script>
      <script>
        function changeBackgroundColor(color) {
        document.getElementById('background').style.backgroundColor = color;
        }

        // Example: You can call this function whenever you need to change the background
        // changeBackgroundColor('rgba(255, 255, 255, 0.5)'); // White with some transparency
      </script>            
      <script>
        document.addEventListener('DOMContentLoaded', function() {
          const playbackDuration = ${playbackDuration}; // Example duration (ms)
          const playbackProgress_ms = ${playbackProgress_ms}; // Set progress (ms)
          let elapsedTime = playbackProgress_ms;
          let initialPercentage = (playbackProgress_ms / playbackDuration) * 100;

          function formatTime(ms) {
            const totalSeconds = Math.floor(ms / 1000);
            const minutes = Math.floor(totalSeconds / 60);
            const seconds = totalSeconds % 60;
            return \`\${minutes}:\${seconds.toString().padStart(2, '0')}\`;
          }

          function updateProgressBarAndTimer() {
            const progressBar = document.getElementById('progress');
            const elapsedTimeElement = document.getElementById('time-remaining');

            initialPercentage = (elapsedTime / playbackDuration) * 100;
            if (initialPercentage > 100) initialPercentage = 100;
            progressBar.style.width = initialPercentage + '%';

            elapsedTime += 1000;
            if (elapsedTime >= playbackDuration) {
              clearInterval(interval);
              elapsedTime = playbackDuration;
            }
            elapsedTimeElement.textContent = formatTime(elapsedTime);
          }

          const interval = setInterval(updateProgressBarAndTimer, 1000);
          updateProgressBarAndTimer();
        });
      </script> 
    `;

    const head = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Spotify Queue</title>
      ${styles}
      ${scripts}
    </head>  
    
    `;

    if (statusCode === 200) {
      HTMLpage = `
        ${head}
        <body>
          <div class="container-wrapper" id="containerWrapper">
            <div class="container">
              <!-- Currently Playing Section -->
              <h1>Now playing:</h1>
              <div class="currently-playing">
                <img src="${albumImage}" alt="Album Art">
                <div class="info">
                  <div class="song-title" style="color: ${appConfig.currSongColor};">${currentlyPlaying.name}</div>
                  <div class="artist-name" style="color: ${appConfig.currArtistColor};">${currentlyPlaying.artists.map(artist => artist.name).join(', ')}</div>
                </div>
              </div>
    
              <!-- Progress Bar Section -->
              <div class="progress-container">
                <div class="time" id="time-remaining" style="color: ${appConfig.currTimeColor};">${Math.floor((playbackProgress_ms) / 60000)}:${Math.floor(((playbackProgress_ms) % 60000) / 1000).toString().padStart(2, '0')}</div>
                  <div id="progress-bar">
                    <div id="progress"></div>
                  </div>
                <div class="time" id="total-duration" style="color: ${appConfig.currTimeColor};">${Math.floor(playbackDuration / 60000)}:${Math.floor((playbackDuration % 60000) / 1000).toString().padStart(2, '0')}</div>
              </div>
    
              <!-- Queue Section -->
              <div class="queue-container">
                <h2 class="header">Next up:</h2>
                ${queue.map(track => `
                  <div class="queue-item">
                    <div class="song-info">
                      <h2 style="color: ${appConfig.queueSongColor};">${track.name}</h2>
                      <p style="color: ${appConfig.queueArtistColor};">${track.artists.map(artist => artist.name).join(', ')}</p>
                    </div>
                    <div class="duration" style="color: ${appConfig.QueueTimeColor};">${Math.floor(track.duration_ms / 60000)}:${Math.floor((track.duration_ms % 60000) / 1000).toString().padStart(2, '0')}</div>
                  </div>
                `).join('')}
              </div>
            </div>
          </div>
        </body>
        </html>
      `;
    } else if (statusCode === 204) {
      HTMLpage = `
        ${head}
          <body>
            <div class="container-wrapper" id="containerWrapper">
              <div class="container">
                <!-- Currently Playing Section -->
                <div class="currently-playing">
                  <div class="info">
                    <div class="song-title" style="color: ${appConfig.currSongColor};">Spotify is Not Available or Timed Out.</div>
                    <div class="artist-name" style="color: ${appConfig.currArtistColor};">Start Spotify or Resume Playing the Song.</div>
                  </div>
                </div>
              </div>
            </div>
          </body>
          </html>
        `;
    } else {
      HTMLpage = `
        ${head}
          <body>
            <div class="container-wrapper" id="containerWrapper">
              <div class="container">
                <!-- Currently Playing Section -->
                <div class="currently-playing">
                  <div class="info">
                    <div class="song-title" style="color: ${appConfig.currSongColor};">Encountered an Unexpected ERORR : ${statusCode}</div>
                    <div class="artist-name" style="color: ${appConfig.currArtistColor};">
                      <p class="error-p">Make sure Spotify is running and playing a song.</p>
                      <p class="error-p">Try again.......</p> 
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </body>
          </html>
        `;
      };

    // Render an HTML page with the currently playing track and queue data
    res.send(HTMLpage);
  } catch (error) {
      console.error('appserver.cjs > Error fetching playback state or queue:', error);
      res.send(`Error: ${error.message}`);
  }
});

// ==== TOKEN HANDLING FUNCTIONS ====
// Function to refresh the access token
const refreshAccessToken = async () => {
    try {
      const data = await spotifyApi.refreshAccessToken();
      accessToken = data.body.access_token;
      tokenExpiration = Date.now() + (data.body.expires_in - 60) * 1000; // Update expiration time
      spotifyApi.setAccessToken(accessToken);
      console.log('appserver.cjs > Access token refreshed');
    } catch (error) {
      console.error('appserver.cjs > Error refreshing access token:', error);
    }
  };


// ==== UTILITY FUNCTIONS ====
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

// Function to convert milliseconds to mm:ss format
function convertDurationToMMSS(durationMs) {
  const minutes = Math.floor(durationMs / 60000); // 1 minute = 60000 milliseconds
  const seconds = Math.floor((durationMs % 60000) / 1000); // Get the remaining seconds
  const formattedSeconds = seconds < 10 ? `0${seconds}` : seconds; // Add leading zero if seconds are less than 10

  return `${minutes}:${formattedSeconds}`;
}  


// ==== SPOTIFY FUNCTIONS TO ACCESS DATA ====

// Helper function to get artist genres using axios
const getArtistGenres = async (artistIds) => {
  try {
    // Create a comma-separated list of artist IDs
    const ids = artistIds.join(',');

    // Make the API request to get artist data
    const response = await axios.get(`https://api.spotify.com/v1/artists?ids=${ids}`, {
      headers: {
        'Authorization': `Bearer ${spotifyApi.getAccessToken()}`,  // Use the current access token
      }
    });

    // Extract artist data and map to an array of objects with id and genres
    const artists = response.data.artists;
    return artists.map(artist => ({
      id: artist.id,
      genres: artist.genres
    }));

  } catch (error) {
    console.error('appserver.cjs > Error fetching artist genres:', error);
    return [];
  }
};


// Function to get audio features for a track using axios
async function getTrackAudioFeatures(trackId) {
  try {
    // Make the API request to get audio features for the track
    const response = await axios.get(`https://api.spotify.com/v1/audio-features/${trackId}`, {
      headers: {
        'Authorization': `Bearer ${spotifyApi.getAccessToken()}`,  // Use the current access token
      }
    });

    const features = response.data; // Extract the data from the response
    return {
      tempo: features.tempo.toFixed(0), // Round BPM to 0 decimal places
      energy: features.energy,
      danceability: features.danceability,
      valence: features.valence
    };

    console.error(`appserver.cjs > Error fetching audio features for track ID ${trackId}:`, error);
    return null; // Return null or handle the error as needed

  } catch (error) {
    if (error.response && error.response.status === 429) {
      // Set getting the track features to false
      addAudioFeatures = false
      console.error(`Rate limit exceeded. Setting displaying trak features off`);
    } else {
      console.error('Error fetching track features:', error);

    }
  }
}

// Helper function to get genres for a list of tracks
const getTracksGenres = async (tracks) => {
  try {
    const artistIds = tracks.flatMap(track => track.artists.map(artist => artist.id));
    const uniqueArtistIds = [...new Set(artistIds)]; // Remove duplicate artist IDs
    const artistGenres = await getArtistGenres(uniqueArtistIds);
    
    // Map genres to tracks
    return tracks.map(track => {
      const trackArtistIds = track.artists.map(artist => artist.id);
      const genres = artistGenres
        .filter(artistGenre => trackArtistIds.includes(artistGenre.id))
        .flatMap(artistGenre => artistGenre.genres)
        .join(', ');
      return genres || 'Unknown';
    });
  } catch (error) {
    console.error('appserver.cjs > Error mapping genres to tracks:', error);
    return tracks.map(() => 'Unknown');
  }
};

// Helper function to get audio features for a list of tracks using axios
async function getTracksFeatures(trackIds) {
  const featuresList = [];

  for (const trackId of trackIds) {
    const features = await getTrackAudioFeatures(trackId);
    if (features) {
      featuresList.push(features);
    } else {
      console.error(`appserver.cjs > Warning: No audio features found for track ID ${trackId}`);
    }
  }

  return featuresList;
}

// ==== SERVER FUNCTIONS ====
expressApp.get('/health', (req, res) => {
  res.status(200).send('Server is running');
});

function checkPortAvailability(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', (err) => {
      if(err.code === 'EADDRINUSE') {
        resolve(false); //Port is in use
      } else {
        resolve(true); // Other error, treat port as available
      }
    });
    server.once('listening',() => {
      server.close(() => resolve(true)); // Port is available
    });
    server.listen(port);
  });
}

checkPortAvailability(port)
  .then((isAvailable) => {
    if (isAvailable) {
      expressApp.listen(port, () => {
        console.log(`appserver.cjs > Server running at http://localhost:${port}`);
        console.log(`appserver.cjs > Press Ctrl+C to stop the server.`);
      })
    } else {
      console.log(`appserver.cjs > Port ${port} is already in use, but that is expected.`);
    }
  })

module.exports = expressApp; // Export the server instance

function gracefulshutdown() { 
    console.log("appserver.cjs > Shutting down"); 
    expressApp.close(() => { 
        console.log("appserver.cjs > HTTP server closed."); 
          
        // When server has stopped accepting connections  
        // exit the process with exit status 0 
        process.exit(0);  
    }); 
  } 
  
  process.on("SIGTERM", gracefulshutdown);