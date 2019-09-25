// Constants
const GH_APP_NAME = 'visual-difference';
const CHECK_RUN_NAME = 'Visual Difference Tests';
const VD_TEST_MSG = 'Stage 2: Visual-difference-tests';
const VD_TEST_FAILURE = 'Stage 2: Visual-difference-tests\\nThis stage **failed**';

const PREFIX = "https://api.github.com";
const TRAVIS_PREFIX = "https://travis-ci.com/";
const TRAVIS_MIDDLE = "/builds/";

var repoPath = '';
var repoPathTravis = '';

var travis_pr_build = 'Travis CI - Pull Request';
var failure = 'failure';
var success = 'success';
var regenCommand = 'r';
var masterCommand = 'm';

var latestToken = '';
var installationID = 0;

var dictionary = {};

const got = require('got');
const { App } = require("@octokit/app");
const { request } = require("@octokit/request");

/**
 * @param {import('probot').Application} app
 */
module.exports = app => {
    // Update our stored information anytime there is an event.
    app.on('*', async context => {
        await updateGlobals(context);
    })

    // On a check run event perform some checks
    app.on('check_run', async context => {
        console.log(getToken())

        // If it's a travis PR build, check the progress and make a VD check run.
        if (context.payload.check_run.name == travis_pr_build) {
            const hasVDTest = await hasVisualDiffTest(context.payload.check_run.id);
            if (hasVDTest) {
                createCheckRunProgress(context);
            }
        }

        // If the travis PR build finished and failed, check if VD tests failed.
        if (context.payload.check_run.conclusion == failure && context.payload.check_run.name == travis_pr_build) {
            getCheckRunSummaryAndCommentOnFailure(context, context.payload.check_run.id)
        }

        // If the travis PR build finished and finished, mark VD tests as completed.
        if (context.payload.check_run.conclusion == success && context.payload.check_run.name == travis_pr_build) {
            const hasVDTest = await hasVisualDiffTest(context.payload.check_run.id);
            if (hasVDTest) {
                createCheckRunComplete(context);
            }
        }
    })

    // On a requested action button press from the user
    app.on('check_run.requested_action', async context => {
        getToken()

        // Are we regenerating the goldens from the current branch?
        if (context.payload.requested_action.identifier.includes(regenCommand)) {
            getBranchNameAndRegenGoldens(context, JSON.parse(context.payload.requested_action.identifier).n)
        }

        // Are we regenerating the goldens from the master branch?
        if (context.payload.requested_action.identifier.includes(masterCommand)) {
            regenGoldens(context, JSON.parse(context.payload.requested_action.identifier).n, "master")
        }
    })
}

async function updateGlobals(context) {
    installationID = context.payload.installation.id;
    repoPath = context.payload.repository.url.split(PREFIX)[1];
    repoPathTravis = repoPath.replace("/repos", "/repo")
    var regex = /\/(?=[^\/]*$)/g
    repoPathTravis = repoPathTravis.replace(regex, "%2F")
}


// Timer function
const timer = ms => new Promise(res => setTimeout(res, ms));

// Does this check run have a visual difference test?
async function hasVisualDiffTest(checkRunID) {

    await got(
        repoPath + '/check-runs/' + checkRunID, {
        baseUrl: 'https://api.github.com',
        headers: {
            'Content-Type': 'application/json',
            'User-Agent': GH_APP_NAME,
            'Accept': 'application/vnd.github.antiope-preview+json'
        },
        timeout: 2500
    });

    try {
        const response = await got(
            '' + ,
            options
        );
        return message.includes(VD_TEST_MSG);

    } catch (error) {
        console.log("hello")
        console.log(error.response.body);
    }
}

// Get the Check Run Summary and Comment on a Failure
function getCheckRunSummaryAndCommentOnFailure(context, checkRunID) {
    // Parameters for the API call
    const https = require('https')
    const getOptions = {
        hostname: 'api.github.com',
        port: 443,
        path: repoPath + '/check-runs/' + checkRunID,
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
            'User-Agent': GH_APP_NAME,
            'Accept': 'application/vnd.github.antiope-preview+json'
        },
        timeout: 2500
    }

    // Get the summary
    const req = https.get(getOptions, (res) => {
        let data = ''

        res.on('data', (chunk) => {
            data += chunk
        })
        res.on('end', () => {
            // Check if the build failed and comment
            checkIfVDBuildFailedAndComment(context, String(data))
        })
    }).on("error", (err) => {
        console.log("Error: " + err.message)
    })
    req.end()
}
// Did the visual difference test fail? Leave a comment if so.
function checkIfVDBuildFailedAndComment(context, message) {
    if (message.includes(VD_TEST_FAILURE)) {
        commentFailedVD(context)
    }
}
// Comment on the PR letting the dev know that the VD tests failed.
function commentFailedVD(context) {
    // Extract the number, repo and repo owner from the check run.
    let issueNumber = 0
    let repoName = ''
    let repoOwner = ''
    let url = context.payload.check_run.details_url
    let extID = context.payload.check_run.external_id

    for (let element of context.payload.check_run.pull_requests) {
        if (element.hasOwnProperty('number')) {
            issueNumber = element.number
            repoName = element.base.repo.name
            break;
        }
    }
    repoOwner = context.payload.organization.login

    // Post a comment letting the dev know their build failed.
    let params = ({
        body: 'Hey there! It looks like your "' + travis_pr_build + '" \
               build failed, due to the visual difference test failing. \
               Check out the details of the Travis build [here](' + url + '). \
               To regenerate the goldens please click the "Details" link on the "Visual Difference Tests" check.',
        number: issueNumber,
        owner: repoOwner,
        repo: repoName
    })

    // Mark the check run as failing
    createCheckRunFail(context, issueNumber, extID);

    // Post a comment on the PR
    return context.github.issues.createComment(params)
}

// Create an in-progress check-run
function createCheckRunProgress(context) {
    console.log("Waiting for 5 seconds...")
    timer(5000).then(_ => getToken());

    // Parameters for the API call
    const https = require('https')
    const data = JSON.stringify({
        'name': CHECK_RUN_NAME,
        'head_sha': context.payload.check_run.head_sha,
        'status': 'in_progress',
        'started_at': context.payload.check_run.started_at,
        'output': {
            'title': CHECK_RUN_NAME,
            'summary': 'Visual difference tests are in progress.'
        },
        'details_url': context.payload.check_run.details_url
    })

    const postOptions = {
        hostname: 'api.github.com',
        port: 443,
        path: repoPath + '/check-runs',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': data.length,
            'User-Agent': GH_APP_NAME,
            'Accept': 'application/vnd.github.antiope-preview+json',
            'Authorization': 'Token ' + latestToken
        },
        timeout: 2500
    }

    // Send the request
    const req = https.request(postOptions, (res) => {

        res.on('data', (d) => {
            if (res.statusCode == 200 || res.statusCode == 201) {
                console.log("Visual difference checks in-progress.")
            }
        })
    })
    req.on('error', (error) => {
        console.error(error)

    })
    req.write(data)
    req.end()
}
// Create a failed check run
function createCheckRunFail(context, issueNum, extID) {
    getToken()
    // Parameters for the API call
    const https = require('https')
    const data = JSON.stringify({
        'name': CHECK_RUN_NAME,
        'head_sha': context.payload.check_run.head_sha,
        'status': 'completed',
        'conclusion': failure,
        'started_at': context.payload.check_run.started_at,
        'completed_at': context.payload.check_run.completed_at,
        'actions': [{
            "label": "Regenerate Goldens",
            "description": "Regenereate the Golden images.",
            "identifier": JSON.stringify({
                "c": regenCommand,
                "n": issueNum
            })
        }, {
            "label": "Reset Goldens",
            "description": "Reset goldens to master.",
            "identifier": JSON.stringify({
                "c": masterCommand,
                "n": issueNum
            })
        }],
        'output': {
            'title': CHECK_RUN_NAME,
            'summary': 'Visual difference tests failed.'
        },
        'details_url': context.payload.check_run.details_url
    })

    // Store the build ID
    dictionary.issueNum = extID;

    const postOptions = {
        hostname: 'api.github.com',
        port: 443,
        path: repoPath + '/check-runs',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': data.length,
            'User-Agent': GH_APP_NAME,
            'Accept': 'application/vnd.github.antiope-preview+json',
            'Authorization': 'Token ' + latestToken
        },
        timeout: 2500
    }

    // Send the request
    const req = https.request(postOptions, (res) => {

        res.on('data', (d) => {
            if (res.statusCode == 200 || res.statusCode == 201) {
                console.log("Visual difference checks failed.")
            }
        })
    })
    req.on('error', (error) => {
        console.error(error)

    })
    req.write(data)
    req.end()
}
// Create a completed check run
function createCheckRunComplete(context) {
    getToken()
    // Parameters for the API call
    const https = require('https')
    const data = JSON.stringify({
        'name': CHECK_RUN_NAME,
        'head_sha': context.payload.check_run.head_sha,
        'status': 'completed',
        'conclusion': success,
        'started_at': context.payload.check_run.started_at,
        'completed_at': context.payload.check_run.completed_at,
        'output': {
            'title': CHECK_RUN_NAME,
            'summary': 'Visual difference tests passed!'
        },
        'details_url': context.payload.check_run.details_url
    })

    const postOptions = {
        hostname: 'api.github.com',
        port: 443,
        path: repoPath + '/check-runs',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': data.length,
            'User-Agent': GH_APP_NAME,
            'Accept': 'application/vnd.github.antiope-preview+json',
            'Authorization': 'Token ' + latestToken
        },
        timeout: 2500
    }

    // Send the request
    const req = https.request(postOptions, (res) => {
        res.on('data', (d) => {
            if (res.statusCode == 200 || res.statusCode == 201) {
                console.log("Visual difference checks passed.")
            }
        })
    })
    req.on('error', (error) => {
        console.error(error)

    })
    req.write(data)
    req.end()
}

// Gets the branch name from the current PR and regenerates the goldens
function getBranchNameAndRegenGoldens(context, issueNum) {
    let branchName = ''

    // Parameters for the API call
    const https = require('https')
    const getOptions = {
        hostname: 'api.github.com',
        port: 443,
        path: repoPath + '/pulls/' + issueNum,
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
            'User-Agent': GH_APP_NAME
        },
        timeout: 2500
    }

    // Get the branch name first
    const req = https.get(getOptions, (res) => {
        let data = ''
        let prInfo = {}

        res.on('data', (chunk) => {
            data += chunk
        })
        res.on('end', () => {
            prInfo = JSON.parse(data)
            branchName = prInfo.head.ref
            regenGoldens(context, issueNum, branchName)
        })
    }).on("error", (err) => {
        console.log("Error: " + err.message)
    })
    req.end()
}

// Regenerates the goldens
function regenGoldens(context, issueNum, branchName) {
    // Format the request
    const https = require('https')
    const data = JSON.stringify({
        "request": {
            "config": {
                "merge_mode": "merge",
                "script": [
                    "npm run test:diff:golden"
                ]
            },
            "branch": branchName,
            "message": "Regenerating the goldens from the '" + branchName + "' branch."
        }
    })
    const postOptions = {
        hostname: 'api.travis-ci.com',
        port: 443,
        path: repoPathTravis + '/requests',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': data.length,
            'Accept': 'application/json',
            'Travis-API-Version': '3',
            'Authorization': 'token ' + process.env.TRAVIS_AUTH
        },
        timeout: 2500
    }

    // Send the request (ask travis to regenerate the goldens)
    const req = https.request(postOptions, (res) => {
        let data = ''
        let resp = ''
        let reqId = ''

        res.on('data', (chunk) => {
            data += chunk
        })

        res.on('end', () => {
            resp = JSON.parse(data)
            reqId = resp.request.id

            console.log("Waiting for 5 seconds...")
            timer(5000).then(_ => getStatusRegen(context, issueNum, branchName, reqId));
        })
    })
    req.on('error', (error) => {
        console.error(error)

    })
    req.write(data)
    req.end()
}

function getStatusRegen(context, issueNum, branchName, reqId) {
    // Get the build details from travis
    const https = require('https')
    const getOptions = {
        hostname: 'api.travis-ci.com',
        port: 443,
        path: repoPathTravis + '/request/' + reqId,
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Travis-API-Version': '3',
            'Authorization': 'token ' + process.env.TRAVIS_AUTH
        },
        timeout: 2500
    }

    // Get the build url first
    const req = https.get(getOptions, (res) => {
        let data = ''
        let resp = ''
        let buildID = ''

        res.on('data', (chunk) => {
            data += chunk
        })
        res.on('end', () => {
            resp = JSON.parse(data)

            for (let element of resp.builds) {
                buildID = element.id
                break;
            }

            let buildUrl = TRAVIS_PREFIX + repoPath.split("/repos/")[1] + TRAVIS_MIDDLE + buildID

            // Let the dev know what is going on.
            let params = context.issue({
                body: 'The goldens will be regenerated off of the "' + branchName + '" branch shortly. \
                        You can check the status of the build [here](' + buildUrl + '). \
                        Once the build is done, the visual difference tests will be re-run automatically.',
                number: issueNum
            })

            if (dictionary.hasOwnProperty(issueNum)) {
                reRunBuild(dictionary.issueNum)
            } else {
                params = context.issue({
                    body: 'The goldens will be regenerated off of the "' + branchName + '" branch shortly. \
                            You can check the status of the build [here](' + buildUrl + '). \
                            Once the build is done, you will need to re-run the visual difference tests manually using the GitHub UI. \
                            Normally, we can do this for you, but we were unable to perform the request this time.',
                    number: issueNum
                })
            }

            // Post a comment on the PR
            return context.github.issues.createComment(params)

        })
    }).on("error", (err) => {
        console.log("Error: " + err.message)
    })
    req.end()
}

function reRunBuild(buildID) {
    // Parameters for the API call
    const https = require('https')
    const postOptions = {
        hostname: 'api.travis-ci.com',
        port: 443,
        path: '/build/' + buildID + '/restart',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Travis-API-Version': '3',
            'Authorization': 'token ' + process.env.TRAVIS_AUTH
        },
        timeout: 2500
    }

    // Send the request
    const req = https.get(postOptions, (res) => {
        res.on('data', (d) => {
            if (res.statusCode == 200 || res.statusCode == 201) {
                console.log("Requested re-run of build.")
            }
        })
    }).on("error", (err) => {
        console.log("Error: " + err.message)
    })
    req.end()
}