console.log("Content script is running...");

// Global variables
let activeTooltip = null;
let tooltipTimeout = null;
let termCache = new Map();  // Cache for fetched tooltips

// Utility function to escape special characters in medical terms for regex
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Function to fetch the definition from MDWiki.org, limit to 3 sentences, and handle redirects
async function fetchDefinition(term) {
  if (termCache.has(term)) return termCache.get(term);  // Return cached result if available

  const apiUrl = 'https://mdwiki.org/w/api.php?action=query&prop=extracts|pageimages&exintro&titles=' + encodeURIComponent(term) + '&format=json&pithumbsize=200&redirects=1&origin=*';
  try {
    const response = await fetch(apiUrl);
    const data = await response.json();

    // Check if the term redirects to another article
    if (data.query.redirects) {
      const newTitle = data.query.redirects[0].to;
      console.log(`Redirected: ${term} -> ${newTitle}`);
      return await fetchDefinition(newTitle);  // Recursively fetch the redirected term
    }

    // Check if we are dealing with a disambiguation page
    if (data.query.pages) {
      const pageId = Object.keys(data.query.pages)[0];
      const page = data.query.pages[pageId];

      // Handle disambiguation pages (they often lack an extract)
      if (page && page.pageid && page.missing === undefined && page.extract) {
        const extract = page.extract || 'Definition not available.';
        const imageUrl = page.thumbnail ? page.thumbnail.source : null;

        const sentences = extract.split(/(?<!\w\.\w.)(?<![A-Z][a-z]\.)(?<=\.|\?)\s/);
        const limitedText = sentences.slice(0, 3).join(' ');

        const result = { text: limitedText, image: imageUrl };
        termCache.set(term, result);  // Cache the result
        return result;
      } else {
        console.warn(`Disambiguation or missing content for term: ${term}`);
        return { text: 'Disambiguation or definition not available.', image: null };
      }
    }
  } catch (error) {
    console.error('Error fetching definition:', error);
    return { text: 'Error retrieving definition.', image: null };
  }
}

// Function to load medical terms from the local JSON file
async function loadMedicalTerms() {
  try {
    const response = await fetch(chrome.runtime.getURL('medical-terms.json'));
    const data = await response.json();
    return new Set(data.terms.map(term => term.toLowerCase()));  // Use Set for fast lookup and lowercase terms
  } catch (error) {
    console.error('Error loading medical terms:', error);
    return new Set();  // Fallback to empty set
  }
}

// Helper function to check if an element is visible and not processed
function isVisibleAndNotProcessed(element) {
  return element.nodeType === Node.TEXT_NODE &&
         element.textContent.trim() !== '' &&
         element.parentNode &&
         window.getComputedStyle(element.parentNode).display !== 'none' &&
         !element.parentNode.hasAttribute('data-processed');
}

// Function to highlight medical terms with smaller batch sizes and tooltip caching
function highlightTermsWithOverlay(medicalTermsSet, nodes) {
  const batchSize = 20;
  let index = 0;

  function processBatch() {
    const end = Math.min(index + batchSize, nodes.length);
    for (let i = index; i < end; i++) {
      const node = nodes[i];
      const textContent = node.nodeValue;

      if (!textContent || textContent.trim().length === 0) continue;

      let currentOffset = 0;
      while (currentOffset < textContent.length) {
        let foundTerm = null;
        let foundStartOffset = -1;

        for (let term of medicalTermsSet) {
          const termIndex = textContent.toLowerCase().indexOf(term, currentOffset);
          // Ensure the term is not part of a larger word
          if (termIndex !== -1 && (termIndex === 0 || !/\w/.test(textContent[termIndex - 1])) && (termIndex + term.length === textContent.length || !/\w/.test(textContent[termIndex + term.length]))) {
            if (foundStartOffset === -1 || termIndex < foundStartOffset) {
              foundTerm = term;
              foundStartOffset = termIndex;
            }
          }
        }

        if (foundTerm) {
          const startOffset = foundStartOffset;
          const endOffset = startOffset + foundTerm.length;

          const range = document.createRange();
          range.setStart(node, startOffset);
          range.setEnd(node, endOffset);

          const highlightLink = document.createElement('a');
          highlightLink.className = 'highlighted-term';
          highlightLink.textContent = textContent.substring(startOffset, endOffset);
          highlightLink.href = 'https://mdwiki.org/wiki/' + encodeURIComponent(foundTerm);
          highlightLink.target = '_blank';
          highlightLink.rel = 'noopener noreferrer';
          highlightLink.setAttribute('data-processed', 'true');  // Mark as processed

          highlightLink.addEventListener('mouseenter', async () => {
            if (activeTooltip) {
              activeTooltip.remove();
              activeTooltip = null;
            }

            if (!highlightLink.dataset.tooltip) {
              const { text: definition, image: imageUrl } = await fetchDefinition(foundTerm);
              highlightLink.dataset.tooltip = definition;
              highlightLink.dataset.imageUrl = imageUrl;
            }

            const tooltip = document.createElement('div');
            tooltip.className = 'term-tooltip';
            tooltip.innerHTML = highlightLink.dataset.tooltip;

            if (highlightLink.dataset.imageUrl) {
              const image = document.createElement('img');
              image.src = highlightLink.dataset.imageUrl;
              image.style.maxWidth = '100px';
              image.style.display = 'block';
              tooltip.appendChild(image);
            }

            document.body.appendChild(tooltip);

            const rect = highlightLink.getBoundingClientRect();
            tooltip.style.position = 'absolute';
            tooltip.style.top = `${rect.bottom + window.scrollY}px`;
            tooltip.style.left = `${rect.left + window.scrollX}px`;
            tooltip.style.maxWidth = '400px';
            tooltip.style.zIndex = '1000';
            tooltip.style.backgroundColor = '#fff';
            tooltip.style.border = '1px solid gray';
            tooltip.style.padding = '8px';
            tooltip.style.borderRadius = '5px';
            tooltip.style.boxShadow = '0px 4px 12px rgba(0, 0, 0, 0.1)';

            activeTooltip = tooltip;

            tooltip.addEventListener('mouseenter', () => {
              if (tooltipTimeout) clearTimeout(tooltipTimeout);
            });

            function removeTooltipIfNecessary() {
              tooltipTimeout = setTimeout(() => {
                if (!tooltip.matches(':hover') && !highlightLink.matches(':hover')) {
                  if (activeTooltip) {
                    activeTooltip.remove();
                    activeTooltip = null;
                  }
                }
              }, 300);
            }

            tooltip.addEventListener('mouseleave', removeTooltipIfNecessary);
            highlightLink.addEventListener('mouseleave', removeTooltipIfNecessary);
          });

          range.surroundContents(highlightLink);
          currentOffset = endOffset;
        } else {
          break;
        }
      }
    }

    index = end;
    if (index < nodes.length) {
      requestAnimationFrame(processBatch);
    }
  }

  requestAnimationFrame(processBatch);
}

// Function to highlight medical terms using regex pattern
function highlightMedicalTerms(medicalTermsSet) {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
  let node;
  const nodes = [];

  while ((node = walker.nextNode())) {
    if (isVisibleAndNotProcessed(node)) {
      nodes.push(node);
    }
  }

  highlightTermsWithOverlay(medicalTermsSet, nodes);
}

// MutationObserver to debounce DOM changes
let domChangeTimeout = null;
const observer = new MutationObserver((mutations, observerInstance) => {
  if (domChangeTimeout) clearTimeout(domChangeTimeout);

  domChangeTimeout = setTimeout(() => {
    observerInstance.disconnect();
    loadMedicalTerms().then(medicalTermsSet => highlightMedicalTerms(medicalTermsSet));
    observerInstance.observe(document.body, { childList: true, subtree: true });
  }, 200);
});

// Start observing
observer.observe(document.body, { childList: true, subtree: true });

// Initial call to load terms and highlight
loadMedicalTerms().then(medicalTermsSet => highlightMedicalTerms(medicalTermsSet));

// Basic styles
const style = document.createElement('style');
style.innerHTML = `
  .highlighted-term {
    text-decoration: underline;
    color: inherit;
    text-decoration-color: green;
    cursor: pointer;
  }

  .highlighted-term:visited {
    color: inherit;
    text-decoration-color: green;
  }

  .highlighted-term:hover {
    text-decoration: underline;
    text-decoration-color: blue;
    color: inherit;
  }

  .term-tooltip {
    font-size: 16px;
    background-color: white;
    color: black;
    border: 1px solid gray;
    padding: 5px;
    position: absolute;
    z-index: 1000;
    max-width: 400px;
    word-wrap: break-word;
    border-radius: 5px;
    box-shadow: 0px 4px 12px rgba(0, 0, 0, 0.1);
  }
`;
document.head.appendChild(style);

// Remove tooltip on scroll
window.addEventListener('scroll', () => {
  if (activeTooltip) {
    activeTooltip.remove();
    activeTooltip = null;
  }
});