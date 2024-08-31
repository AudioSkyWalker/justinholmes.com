import {createCanvas} from 'canvas';
import {Chart, registerables} from 'chart.js';
import {fileURLToPath} from "url";
import yaml from 'js-yaml';
import path from "path";
import fs from "fs";
import {slugify} from "./utils/text_utils.js";

// Log the time.
console.time("show-and-song-data");

Chart.register(...registerables);
Chart.defaults.color = '#fff';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const imagesSourceDir = path.join(__dirname, '../images');
// Make a 'charts' directory in the images directory.
const chartsDir = path.join(imagesSourceDir, 'charts');
if (!fs.existsSync(chartsDir)) {
    fs.mkdirSync(chartsDir, {recursive: true});
}

const dataDir = path.resolve(__dirname, '../data');

const showsDir = path.resolve(dataDir, 'shows');
const liveShowYAMLs = fs.readdirSync(showsDir);

let shows = {};
let songs = {};
let songAlternateNames = {};
let songShorthands = {};
let allSongPlays = [];
let tours = {};


/// FIRST LOOP: SONG YAML FILES ///

const songYAMLFiles = fs.readdirSync(path.resolve(dataDir, 'songs_and_tunes'));

for (let i = 0; i < songYAMLFiles.length; i++) {
    let songYAML = songYAMLFiles[i];
    let songSlug = songYAML.split('.')[0];

    let songYAMLFile = fs.readFileSync(path.resolve(dataDir, 'songs_and_tunes', songYAML));
    let song = yaml.load(songYAMLFile);
    song.plays = [];

    // If the song has a primary display name, use that as the title and slug.
    if (song.hasOwnProperty('primary_display_name')) {
        song.title = song['primary_display_name'];
        songs[slugify(song['primary_display_name'])] = song;
        // And add the filename slug as a shorthand.
        songShorthands[songSlug] = slugify(song['primary_display_name']);
    } else {
        songs[songSlug] = song;
    }
    song.slug = songSlug;
    // Also slugify any alternate names and add them.
    if (song.hasOwnProperty('alternate_names')) {
        for (let alt_name of song['alternate_names']) {
            songAlternateNames[slugify(alt_name)] = songSlug;
        }
    }
} // First song loop.


////////////// SHOW YAMLs //////////////
// Sort liveShowYAMLs in reverse (so that most recent shows are first)..
liveShowYAMLs.sort().reverse();

let liveShowIDs = [];
for (let i = 0; i < liveShowYAMLs.length; i++) {
    let showYAML = liveShowYAMLs[i];
    let showID = showYAML.split('.')[0];
    let artistID = showID.split('-')[0];
    let blockheight = showID.split('-')[1];
    // liveShowIDs.push(showID);

    let showYAMLFile = fs.readFileSync(path.resolve(showsDir, showYAML));
    let showYAMLData = yaml.load(showYAMLFile);
    showYAMLData['show_id'] = showID; // TODO: Better modeling somehow.  WWDD?

    // If show is part of a tour, add it to that tour.
    if (showYAMLData.hasOwnProperty('tour')) {
        let tour = showYAMLData['tour'];

        if (!tours.hasOwnProperty(tour)) {
            tours[tour] = [];
        }

        tours[tour].push(showID);
    }

    let sets_in_this_show = {}

    for (let [set_number, set] of Object.entries(showYAMLData['sets'])) {

        let this_set = {
            "songplays": [],
            "_show": showYAMLData,
            "set_number": set_number} // TODO: Better modeling somehow.  WWDD?


        // Now we'll iterate through the songs in this set.
        // Some of them will just be strings, while others will be objects, with songPlay details.
        for (let s = 0; s < set["songplays"].length; s++) {

            let songPlay = {
                artistID: artistID,
                showID: showID,
                _set: this_set,
            }

            let songEntry = set["songplays"][s];

            let songName;
            if (typeof songEntry === 'string') {
                songName = songEntry;
            } else {
                songName = Object.keys(songEntry)[0]
            }

            let songSlug = slugify(songName);

            // Check to see if this song is being referenced by an alternate name.
            if (songAlternateNames.hasOwnProperty(songSlug)) {
                songPlay['as_title'] = songName;
                songSlug = songAlternateNames[songSlug];
            }
            // Check to see if the song is being referenced by a shorthand.
            if (songShorthands.hasOwnProperty(songSlug)) {
                songSlug = songShorthands[songSlug];
            }

            let song;
            // Two possibilities: either we know about the song from its YAML, or we don't.
            if (songs.hasOwnProperty(songSlug)) {
                // We read about this song when we read the YAMLs.
                song = songs[songSlug];
                song.slug = songSlug; // TODO: WWDD?  Just slugify it in a method.
            } else {
                // We don't know about this song.
                song = {
                    "plays": [],
                    "title": songName,
                    "slug": songSlug,
                    "undocumented": true,
                };
                songs[songSlug] = song; // It wasn't in the YAML files, so we'll add it to our songs list here.
            }

            // If the song doesn't have a primary display name, we'll use the songName as the title.
            // Note: This presents an odd situation where, if we list a song with titles that both slugify to the filename (ie, with different punctuation), we'll use the first one.
            if (!song.hasOwnProperty('title')) {
                song.title = songName;
            }

            // Deal with the possible songplay-level properties that might be in the set YAML.
            if (typeof songEntry != 'string') {

                for (let key in songEntry) {
                    if (key === songName) {
                        continue;
                    }
                    if (key === "teases") {
                        songPlay['teases'] = [];
                        for (let tease of songEntry[key]) {
                            songPlay['teases'].push(tease);
                        }
                    } else if (key === "performance_modification") {
                        // TODO: This is such a discrete piece of song logic; feels weird to handle it in a parsing loop.
                        if (songEntry[key] === "can") {
                            // TODO: Track this?
                            songPlay["detail"] = "(around the can)";
                        } else {
                            throw new Error("Unknown performance modification: " + songEntry[key]);
                        }
                    } else if (key === "ensemble-modification") {
                        // TODO: Same - does this belong in a parsing loop?
                        if (songEntry[key] === "justin-solo") {
                            // TODO: Track this?
                            songPlay["detail"] = "(Justin Solo)";
                        } else {
                            throw new Error("Unknown performance modification: " + songEntry[key]);
                        }
                    } else if (key === "mode") {
                        songPlay['mode'] = songEntry[key];
                    } else {
                        throw new Error("Unknown key in song object: " + key);
                    }
                }
            }

            // Teases and reprises are just for the setlist; don't count them in the list of plays for a song.
            if (songPlay.mode !== "tease" && songPlay.mode !== "reprise") {
                song.plays.push(songPlay);
            }
            songPlay._song = song;
            songPlay['songSlug'] = songSlug; // TODO: WWDD?  This can be a method.

            // Add it back into the set.
            this_set.songplays.push(songPlay);

            // And push this songPlay to all songPlays.
            allSongPlays.push(songPlay); // TODO: Why?  Do we use this for something?

            sets_in_this_show[set_number] = this_set;
        } // Songs loop (turns songs into objects)

        showYAMLData['sets'] = sets_in_this_show;
        showYAMLData['number_of_sets'] = Object.keys(sets_in_this_show).length

        // Arguably redundant, but we'll add the artist ID and blockheight to the showYAMLData.
        showYAMLData["artist_id"] = artistID;
        showYAMLData["blockheight"] = blockheight;
        shows[showID] = showYAMLData;
        shows[showID]['resource_url'] = `/shows/${showID}.html`; // TODO Where does this logic really belong?
    } // Sets loop

} // Shows loop

// Now that we've dealt with songPLays, we'll loop through songs again, adding details to our other objects.

let songsByProvenance = {'original': [], 'traditional': [], 'cover': [], 'video_game': [], 'film': [], 'one-off': []};
let songsByArtist = {}; // #TODO: Implement this.
let songsByVideoGame = {};

// Iterate through allSongs.
// We're going to add details to the songs.
Object.entries(songs).forEach(([songSlug, songObject]) => {

    // Note traditionals.
    if (songObject.hasOwnProperty('traditional')) {
        // TODO: Sometimes, we display songs as traditional, but influenced by a particular artist.
        // For example, we call 'circle' a "Carter Family Traditional".
        // Is this a function of the song?  Of the songplay (ie, only when we play it like they did)?
        // how do we reflect it?
        songsByProvenance['traditional'].push(songObject);
    }

    // Video game tunes.
    if (songObject.hasOwnProperty('video_game')) {
        songsByProvenance['video_game'].push(songObject);
        if (!songsByVideoGame.hasOwnProperty(songObject['video_game'])) {
            songsByVideoGame[songObject['video_game']] = [];
        }
        songsByVideoGame[songObject['video_game']].push(songObject);
    }

}); // Second songs loop.


// Iterate through songPlays and add the song details.
for (const songPlay of allSongPlays) {

    let song = songs[songPlay.songSlug];

    // Determine the provenances: original, traditional, cover, or video game tune.

    // Songs with explicit artist ID (ie, an artist already in our data ecosystem).
    if (song.hasOwnProperty('by_artist_id')) {
        if (song['by_artist_id'] === parseInt(songPlay.artistID)) {
            // The artist ID of the song is the same of the artist ID of the show.
            // Thus, this is an original.
            songPlay['provenance'] = 'original';
            songsByProvenance['original'].push(song); // TODO: This is weird - what if someone else is playing it?  Forward-incompatible with other artists.
        } else {
            // This is a cover of another cryptograss artist!  Awesome.
            // TODO: Someday we'll handle this.  But for now, we'll throw an error.
            throw new Error("Need to add support for covers of other cryptograss artists."); // TODO
        }
    }

    // Songs with explicit artist name (ie, an artist not in our data ecosystem).
    if (song.hasOwnProperty('by_artist')) {
        songPlay['provenance'] = 'cover';
        songsByProvenance['cover'].push(song); // TODO: Again, this needs to be forward-compatible with other artists using the service.  The matter of whether it's a cover depends on who is playing it.
    }

    // Sanity check: If the song has a by_artist_id, it should not have a by_artist.
    if (song.hasOwnProperty('by_artist_id') && song.hasOwnProperty('by_artist')) {
        throw new Error("Song has both by_artist_id and by_artist.  This is not allowed.");
    }

    // Now, traditionals.
    if (song.hasOwnProperty('traditional')) {
        songPlay['provenance'] = 'traditional';
    }

    // Video game tunes.
    if (song.hasOwnProperty('video_game')) {
        songPlay['provenance'] = 'video_game';
    }
    // Video game tunes.
    if (song.hasOwnProperty('film')) {
        songPlay['provenance'] = 'film';
    }
    // For now, songs that are undocumented will be considered one-offs.
    if (song.hasOwnProperty('undocumented')) {
        songPlay['provenance'] = 'one-off';
    }

    // Sanity check: did we set a provenance?
    if (!songPlay.hasOwnProperty('provenance')) {
        throw new Error("SongPlay does not have provenance; seems like an impossible state.");
    }

} // songPlays loop

// Now, we'll go through each set again and make a chart for song provenance.
for (let [showID, show] of Object.entries(shows)) {
    let show_provenances = {'original': 0, 'traditional': 0, 'cover': 0, 'video_game': 0, 'film': 0, 'one-off': 0};
    for (let [set_number, set] of Object.entries(show['sets'])) {
        let set_provenances = {'original': 0, 'traditional': 0, 'cover': 0, 'video_game': 0, 'film': 0, 'one-off': 0};
        for (let songPlay of Object.values(set['songplays'])) {
            if (songPlay.hasOwnProperty('provenance')) {
                set_provenances[songPlay['provenance']] += 1;
                show_provenances[songPlay['provenance']] += 1;
            } else {
                throw new Error("SongPlay does not have provenance; seems like an impossible state.");
            }
        }
        //////// CHART TIME ////////
        // Set up the canvas using the canvas library
        const width = 800;
        const height = 600;
        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext('2d');

        const data = {
            labels: ['Originals', 'Traditionals', 'Covers', 'Video Game Tunes'],
            datasets: [
                {
                    label: 'Song Breakdown',
                    data: [set_provenances['original'],
                        set_provenances['traditional'],
                        set_provenances['cover'],
                        set_provenances['video_game']],
                    backgroundColor: [
                        '#2F50D7',
                        'rgb(62,98,32)',
                        'rgb(206,159,6)',
                        'rgb(192, 4, 4)',
                    ],
                    borderColor: [
                        'rgba(255, 99, 132, 1)',
                        'rgba(54, 162, 235, 1)',
                        'rgba(255, 206, 86, 1)',
                        'rgba(75, 192, 192, 1)',
                        'rgba(153, 102, 255, 1)',
                        'rgba(255, 159, 64, 1)',
                    ],
                    borderWidth: 1,
                },
            ],
        };

        const config = {
            type: 'doughnut',
            data: data,
            options: {
                responsive: false, // Since we're rendering server-side, disable responsiveness
                plugins: {
                    legend: {
                        maxWidth: 100,
                        position: 'bottom',
                        labels: {
                            font: {
                                size: 38,
                            },
                            padding: 15,
                            textAlign: 'left',
                            boxWidth: 40,
                        },
                    },
                },
            },
        };
        // Render the chart using Chart.js
        const myChart = new Chart(ctx, config);


        // Save the chart as an image
        const buffer = canvas.toBuffer('image/png');
        let output_file_name = `${chartsDir}//${showID}-set-${set_number}-provenance.png`;

        fs.writeFileSync(output_file_name, buffer);
    } // Set loop

    // Now the chart for the full show.
    // Set up the canvas using the canvas library
    const width = 800;
    const height = 600;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    const data = {
        labels: ['Originals', 'Traditionals', 'Covers', 'Video Game Tunes'],
        datasets: [
            {
                label: 'Song Breakdown',
                data: [show_provenances['original'],
                    show_provenances['traditional'],
                    show_provenances['cover'],
                    show_provenances['video_game']],
                backgroundColor: [
                    '#2F50D7',
                    'rgb(62,98,32)',
                    'rgb(206,159,6)',
                    'rgb(192, 4, 4)',
                ],
                borderColor: [
                    'rgba(255, 99, 132, 1)',
                    'rgba(54, 162, 235, 1)',
                    'rgba(255, 206, 86, 1)',
                    'rgba(75, 192, 192, 1)',
                    'rgba(153, 102, 255, 1)',
                    'rgba(255, 159, 64, 1)',
                ],
                borderWidth: 1,
            },
        ],
    };

    const config = {
        type: 'doughnut',
        data: data,
        options: {
            responsive: false, // Since we're rendering server-side, disable responsiveness
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        font: {
                            size: 38,
                        },
                        textAlign: 'left',
                        boxWidth: 40, // Increase the box width for legend items
                    },
                },
            },
        },
    };
    // Render the chart using Chart.js
    const myChart = new Chart(ctx, config);

    // Save the chart as an image
    const buffer = canvas.toBuffer('image/png');
    let output_file_name = `${chartsDir}//${showID}-full-show-provenance.png`;

    fs.writeFileSync(output_file_name, buffer);
}

console.timeEnd("show-and-song-data");


export {shows, songs, songsByVideoGame, songsByProvenance};