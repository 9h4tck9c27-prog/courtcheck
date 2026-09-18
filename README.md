# courtcheck (web version)

A web page that, every time you open it, checks six LA City pay-tennis parks
and tells you whether a court is free tonight (or tomorrow, after 9pm).
Nothing runs on your computer. No logins, no secrets.

    public/index.html                 the page
    netlify/functions/courts.mjs      the checker that runs on Netlify
    netlify.toml                      tells Netlify where things are

## Put it online (one time, no Terminal needed)

Netlify needs to "build" this once so the checker runs, and its drag-and-drop
uploader doesn't do that. The easy route is through GitHub:

1. Go to https://github.com and sign up (free) if you haven't.
2. Click the + (top right) → New repository. Name it courtcheck. Create.
3. On the empty repository page click "uploading an existing file".
   Drag ALL the files and folders from this folder in (netlify.toml, README.md,
   the public folder, the netlify folder). Click "Commit changes".
4. Go to https://app.netlify.com → Add new site → Import an existing project →
   GitHub → pick courtcheck. Leave the settings alone. Click Deploy.
5. In a minute you get a link like https://something.netlify.app. That's it.
   Rename the site under Site configuration → Site details if you like.

From then on, if I send you an updated file, upload it to GitHub the same way
and Netlify redeploys by itself.

## Changing the parks or hours

Open netlify/functions/courts.mjs. The SITES list and WINDOW_START /
WINDOW_END are at the top. Park names must match the City form exactly.

## If the page says it couldn't check a park

Open your-site.netlify.app/api/courts?debug=1 and send me what it shows.
