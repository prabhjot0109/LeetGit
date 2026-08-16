const loadStatsAndRepo = hook => {
  chrome.storage.local.get(['stats', 'leethub_hook'], data => {
    const stats = data.stats;
    if (stats && stats.solved) {
      $('#p_solved').text(stats.solved);
      $('#p_solved_easy').text(stats.easy);
      $('#p_solved_medium').text(stats.medium);
      $('#p_solved_hard').text(stats.hard);
    }
    const leethubHook = hook || data.leethub_hook;
    if (leethubHook) {
      $('#repo_url').html(
        `<a target="blank" style="color: cadetblue !important; font-size:0.8em;" href="https://github.com/${leethubHook}">${leethubHook}</a>`,
      );
    }
  });
};

const validateAndSavePAT = async token => {
  const response = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
    },
  });

  if (response.ok) {
    const user = await response.json();
    await chrome.storage.local.set({
      leethub_token: token,
      leethub_username: user.login,
    });
    /* GET /user succeeds for ANY valid token, so it only proves the token is live —
       not that it can write to a repo. Classic PATs advertise their scopes in this
       header; fine-grained PATs return it empty, and their per-repo permissions are
       not discoverable here, so we can only warn, never block. */
    const scopes = (response.headers.get('x-oauth-scopes') || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    const missingRepoScope = scopes.length > 0 && !scopes.includes('repo');
    return { success: true, username: user.login, missingRepoScope };
  }

  return { success: false, status: response.status };
};

$('#authenticate').on('click', async () => {
  const token = $('#pat_token').val().trim();
  const authError = $('#auth_error');
  authError.hide().text('');

  if (!token) {
    authError.text('Please enter your GitHub Personal Access Token.').show();
    return;
  }

  $('#authenticate').addClass('loading disabled');

  try {
    const result = await validateAndSavePAT(token);

    if (result.success) {
      if (result.missingRepoScope) {
        authError
          .css('color', '#f0ad4e')
          .text(
            'Token accepted, but it is missing the "repo" scope — pushes to private repositories will fail.',
          )
          .show();
      }
      chrome.storage.local.get(['mode_type', 'leethub_hook'], data => {
        $('#auth_mode').hide();
        if (data.mode_type === 'commit' && data.leethub_hook) {
          $('#commit_mode').show();
          loadStatsAndRepo(data.leethub_hook);
        } else {
          $('#hook_mode').show();
          chrome.tabs.create({ url: chrome.runtime.getURL('src/html/welcome.html') });
        }
      });
    } else if (result.status === 401) {
      authError
        .text('Invalid Personal Access Token. Please check token permissions and try again.')
        .show();
    } else {
      authError
        .text(
          `Authentication failed (HTTP ${result.status}). Please check your connection and try again.`,
        )
        .show();
    }
  } catch (err) {
    console.error('PAT Authentication error:', err);
    authError.text('Network error occurred. Please check your connection and try again.').show();
  } finally {
    $('#authenticate').removeClass('loading disabled');
  }
});

// Toggle PAT collapsible in commit mode
$('#collapsible-pat-icon').click(() => {
  $('#collapsible-pat-icon').toggleClass('open');
  $('#collapsible-pat-container').toggle();
});

// Update PAT button handler
$('#update-pat-btn').click(async () => {
  const newToken = $('#update_pat_token').val().trim();
  const msgSpan = $('#pat-update-message');
  msgSpan.hide().text('');

  if (!newToken) {
    msgSpan.css('color', '#d9534f').text('Please enter a valid token.').show();
    return;
  }

  try {
    const result = await validateAndSavePAT(newToken);
    if (result.success) {
      $('#update_pat_token').val('');
      if (result.missingRepoScope) {
        msgSpan
          .css('color', '#f0ad4e')
          .text('Token saved, but it is missing the "repo" scope — private repo pushes will fail.')
          .show();
      } else {
        msgSpan.css('color', 'green').text('Personal Access Token updated successfully!').show();
        setTimeout(() => {
          msgSpan.hide();
        }, 3000);
      }
    } else {
      msgSpan.css('color', '#d9534f').text('Invalid token. Verification failed.').show();
    }
  } catch (err) {
    console.error('Error updating PAT:', err);
    msgSpan.css('color', '#d9534f').text('Error verifying token.').show();
  }
});

// Unlink PAT button handler
$('#unlink-pat-btn').click(() => {
  /* Clear the whole account footprint, not just the token. `stats.shas` maps
     problem -> file -> blob SHA for the *old* repo; leaving it behind makes the
     next repo look like it already has those files, so READMEs are never created
     and uploads are sent with stale SHAs. */
  chrome.storage.local.remove(['leethub_token', 'leethub_username', 'stats'], () => {
    chrome.storage.local.set({ mode_type: 'hook', leethub_hook: null }, () => {
      $('#p_solved, #p_solved_easy, #p_solved_medium, #p_solved_hard').text('0');
      $('#repo_url').empty();
      $('#commit_mode').hide();
      $('#hook_mode').hide();
      $('#auth_mode').show();
    });
  });
});

$('#welcome_URL').attr('href', chrome.runtime.getURL('src/html/welcome.html'));
$('#hook_URL').attr('href', chrome.runtime.getURL('src/html/welcome.html'));

// Collapsible commit message section
$('#collapsible-commit-message-icon').click(() => {
  $('#collapsible-commit-message-icon').toggleClass('open');
  $('#collapsible-commit-message-container').toggle();
  chrome.storage.local.get(['custom_commit_message'], data => {
    let commitMessage = data.custom_commit_message;
    if (!commitMessage) {
      $('#custom-commit-msg').attr('placeholder', 'Time: {time}, Space: {space} - LeetHub');
    } else {
      $('#custom-commit-msg').attr('placeholder', commitMessage);
      $('#custom-commit-msg').val(commitMessage);
    }
  });
});

// Toggle difficulty folder section
$('#collapsible-difficulty-icon').click(() => {
  $('#collapsible-difficulty-icon').toggleClass('open');
  $('#collapsible-difficulty-container').toggle();

  chrome.storage.local.get({ useDifficultyFolder: false }, data => {
    $('#use-difficulty-folder').prop('checked', data.useDifficultyFolder);
  });
});

$('#use-difficulty-folder').change(function () {
  const isChecked = $(this).is(':checked');
  chrome.storage.local.set({ useDifficultyFolder: isChecked });
});

// Toggle language folder section
$('#collapsible-language-icon').click(() => {
  $('#collapsible-language-icon').toggleClass('open');
  $('#collapsible-language-container').toggle();

  chrome.storage.local.get({ useLanguageFolder: false }, data => {
    $('#use-language-folder').prop('checked', data.useLanguageFolder);
  });
});

$('#use-language-folder').change(function () {
  const isChecked = $(this).is(':checked');
  chrome.storage.local.set({ useLanguageFolder: isChecked });
});

// Toggle timestamped filenames section
$('#collapsible-timestamp-icon').click(() => {
  $('#collapsible-timestamp-icon').toggleClass('open');
  $('#collapsible-timestamp-container').toggle();

  chrome.storage.local.get({ useTimestampFilename: false }, data => {
    $('#use-timestamp-filename').prop('checked', data.useTimestampFilename);
  });
});

$('#use-timestamp-filename').change(function () {
  const isChecked = $(this).is(':checked');
  chrome.storage.local.set({ useTimestampFilename: isChecked });
});

// Toggle solution post section
$('#collapsible-solution-post-icon').click(() => {
  $('#collapsible-solution-post-icon').toggleClass('open');
  $('#collapsible-solution-post-container').toggle();

  chrome.storage.local.get({ autoCommitSolutionPost: true }, data => {
    $('#auto-commit-solution-post').prop('checked', data.autoCommitSolutionPost);
  });
});

$('#auto-commit-solution-post').change(function () {
  const isChecked = $(this).is(':checked');
  chrome.storage.local.set({ autoCommitSolutionPost: isChecked });
});

$('#msg-save-btn').click(() => {
  const commitMessage = $('#custom-commit-msg').val();
  chrome.runtime.sendMessage({
    action: 'customCommitMessageUpdated',
    message: commitMessage.trim(),
  });

  const successMessage = $('#success-message');
  successMessage.show();
  setTimeout(() => {
    successMessage.hide();
  }, 3000);
});

$('#msg-reset-btn').click(() => {
  $('#custom-commit-msg').val('');
  $('#custom-commit-msg').attr('placeholder', 'Time: {time}, Space: {space} - LeetHub');
  chrome.runtime.sendMessage({ action: 'customCommitMessageUpdated', message: null });
});

$('.commit-variable').on('click', function () {
  const variableName = $(this).attr('id');
  $('#custom-commit-msg').val(function (index, currentValue) {
    return currentValue + `{${variableName}} `;
  });
});

// Initial authentication and state check
chrome.storage.local.get(['leethub_token', 'mode_type', 'leethub_hook'], async data => {
  const token = data.leethub_token;
  if (!token) {
    $('#auth_mode').show();
    return;
  }

  try {
    const response = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
      },
    });

    if (response.ok) {
      if (data.mode_type === 'commit') {
        $('#commit_mode').show();
        loadStatsAndRepo(data.leethub_hook);
      } else {
        $('#hook_mode').show();
      }
    } else if (response.status === 401) {
      chrome.storage.local.set({ leethub_token: null }, () => {
        console.log('Invalid or expired PAT. Resetting to auth mode.');
        $('#auth_mode').show();
        $('#auth_error')
          .text('Your Personal Access Token has expired or is invalid. Please enter a valid PAT.')
          .show();
      });
    } else {
      if (data.mode_type === 'commit') {
        $('#commit_mode').show();
        loadStatsAndRepo(data.leethub_hook);
      } else {
        $('#hook_mode').show();
      }
    }
  } catch (err) {
    console.error('Error verifying stored token:', err);
    if (data.mode_type === 'commit') {
      $('#commit_mode').show();
      loadStatsAndRepo(data.leethub_hook);
    } else {
      $('#hook_mode').show();
    }
  }
});
