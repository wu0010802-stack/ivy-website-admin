// This proposal always uses the selected B layout; only line-art placement varies.
const previewParams = new URLSearchParams(location.search);
previewParams.set('direction', 'b');
history.replaceState(null, '', `${location.pathname}?${previewParams}${location.hash}`);
