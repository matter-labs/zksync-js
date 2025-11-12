// Populate the sidebar
//
// This is a script, and not included directly in the page, to control the total size of the book.
// The TOC contains an entry for each page, so if each page includes a copy of the TOC,
// the total size of the page becomes O(n**2).
class MDBookSidebarScrollbox extends HTMLElement {
    constructor() {
        super();
    }
    connectedCallback() {
        this.innerHTML = '<ol class="chapter"><li class="chapter-item expanded "><a href="overview/index.html"><strong aria-hidden="true">1.</strong> Overview</a></li><li><ol class="section"><li class="chapter-item expanded "><a href="overview/mental-model.html"><strong aria-hidden="true">1.1.</strong> Mental model</a></li><li class="chapter-item expanded "><a href="overview/adapters.html"><strong aria-hidden="true">1.2.</strong> Adapters (viem &amp; ethers)</a></li><li class="chapter-item expanded "><a href="overview/status-vs-wait.html"><strong aria-hidden="true">1.3.</strong> Status vs Wait</a></li><li class="chapter-item expanded "><a href="overview/finalization.html"><strong aria-hidden="true">1.4.</strong> Finalization</a></li></ol></li><li class="chapter-item expanded "><a href="quickstart/index.html"><strong aria-hidden="true">2.</strong> Quickstart</a></li><li><ol class="section"><li class="chapter-item expanded "><a href="quickstart/choose-adapter.html"><strong aria-hidden="true">2.1.</strong> Choose your adapter</a></li><li class="chapter-item expanded "><a href="quickstart/viem.html"><strong aria-hidden="true">2.2.</strong> Quickstart (viem)</a></li><li class="chapter-item expanded "><a href="quickstart/ethers.html"><strong aria-hidden="true">2.3.</strong> Quickstart (ethers)</a></li></ol></li><li class="chapter-item expanded "><a href="guides/index.html"><strong aria-hidden="true">3.</strong> How-to Guides</a></li><li><ol class="section"><li class="chapter-item expanded "><div><strong aria-hidden="true">3.1.</strong> Deposits</div></li><li><ol class="section"><li class="chapter-item expanded "><a href="guides/deposits/viem.html"><strong aria-hidden="true">3.1.1.</strong> viem</a></li><li class="chapter-item expanded "><a href="guides/deposits/ethers.html"><strong aria-hidden="true">3.1.2.</strong> ethers</a></li></ol></li><li class="chapter-item expanded "><div><strong aria-hidden="true">3.2.</strong> Withdrawals</div></li><li><ol class="section"><li class="chapter-item expanded "><a href="guides/withdrawals/viem.html"><strong aria-hidden="true">3.2.1.</strong> viem</a></li><li class="chapter-item expanded "><a href="guides/withdrawals/ethers.html"><strong aria-hidden="true">3.2.2.</strong> ethers</a></li></ol></li></ol></li><li class="chapter-item expanded "><a href="sdk-reference/index.html"><strong aria-hidden="true">4.</strong> SDK Reference</a></li><li><ol class="section"><li class="chapter-item expanded "><div><strong aria-hidden="true">4.1.</strong> Core</div></li><li><ol class="section"><li class="chapter-item expanded "><a href="sdk-reference/core/rpc.html"><strong aria-hidden="true">4.1.1.</strong> rpc</a></li><li class="chapter-item expanded "><a href="sdk-reference/core/errors.html"><strong aria-hidden="true">4.1.2.</strong> errors</a></li></ol></li><li class="chapter-item expanded "><div><strong aria-hidden="true">4.2.</strong> Ethers</div></li><li><ol class="section"><li class="chapter-item expanded "><a href="sdk-reference/ethers/client.html"><strong aria-hidden="true">4.2.1.</strong> client</a></li><li class="chapter-item expanded "><a href="sdk-reference/ethers/sdk.html"><strong aria-hidden="true">4.2.2.</strong> sdk</a></li><li class="chapter-item expanded "><a href="sdk-reference/ethers/contracts.html"><strong aria-hidden="true">4.2.3.</strong> contracts</a></li><li class="chapter-item expanded "><a href="sdk-reference/ethers/deposits.html"><strong aria-hidden="true">4.2.4.</strong> deposits</a></li><li class="chapter-item expanded "><a href="sdk-reference/ethers/withdrawals.html"><strong aria-hidden="true">4.2.5.</strong> withdrawals</a></li><li class="chapter-item expanded "><a href="sdk-reference/ethers/finalization-services.html"><strong aria-hidden="true">4.2.6.</strong> finalization services</a></li><li class="chapter-item expanded "><a href="sdk-reference/ethers/tokens.html"><strong aria-hidden="true">4.2.7.</strong> tokens</a></li></ol></li><li class="chapter-item expanded "><div><strong aria-hidden="true">4.3.</strong> Viem</div></li><li><ol class="section"><li class="chapter-item expanded "><a href="sdk-reference/viem/client.html"><strong aria-hidden="true">4.3.1.</strong> client</a></li><li class="chapter-item expanded "><a href="sdk-reference/viem/sdk.html"><strong aria-hidden="true">4.3.2.</strong> sdk</a></li><li class="chapter-item expanded "><a href="sdk-reference/viem/contracts.html"><strong aria-hidden="true">4.3.3.</strong> contracts</a></li><li class="chapter-item expanded "><a href="sdk-reference/viem/deposits.html"><strong aria-hidden="true">4.3.4.</strong> deposits</a></li><li class="chapter-item expanded "><a href="sdk-reference/viem/withdrawals.html"><strong aria-hidden="true">4.3.5.</strong> withdrawals</a></li><li class="chapter-item expanded "><a href="sdk-reference/viem/finalization-services.html"><strong aria-hidden="true">4.3.6.</strong> finalization services</a></li><li class="chapter-item expanded "><a href="sdk-reference/viem/tokens.html"><strong aria-hidden="true">4.3.7.</strong> tokens</a></li></ol></li></ol></li></ol>';
        // Set the current, active page, and reveal it if it's hidden
        let current_page = document.location.href.toString().split("#")[0];
        if (current_page.endsWith("/")) {
            current_page += "index.html";
        }
        var links = Array.prototype.slice.call(this.querySelectorAll("a"));
        var l = links.length;
        for (var i = 0; i < l; ++i) {
            var link = links[i];
            var href = link.getAttribute("href");
            if (href && !href.startsWith("#") && !/^(?:[a-z+]+:)?\/\//.test(href)) {
                link.href = path_to_root + href;
            }
            // The "index" page is supposed to alias the first chapter in the book.
            if (link.href === current_page || (i === 0 && path_to_root === "" && current_page.endsWith("/index.html"))) {
                link.classList.add("active");
                var parent = link.parentElement;
                if (parent && parent.classList.contains("chapter-item")) {
                    parent.classList.add("expanded");
                }
                while (parent) {
                    if (parent.tagName === "LI" && parent.previousElementSibling) {
                        if (parent.previousElementSibling.classList.contains("chapter-item")) {
                            parent.previousElementSibling.classList.add("expanded");
                        }
                    }
                    parent = parent.parentElement;
                }
            }
        }
        // Track and set sidebar scroll position
        this.addEventListener('click', function(e) {
            if (e.target.tagName === 'A') {
                sessionStorage.setItem('sidebar-scroll', this.scrollTop);
            }
        }, { passive: true });
        var sidebarScrollTop = sessionStorage.getItem('sidebar-scroll');
        sessionStorage.removeItem('sidebar-scroll');
        if (sidebarScrollTop) {
            // preserve sidebar scroll position when navigating via links within sidebar
            this.scrollTop = sidebarScrollTop;
        } else {
            // scroll sidebar to current active section when navigating via "next/previous chapter" buttons
            var activeSection = document.querySelector('#sidebar .active');
            if (activeSection) {
                activeSection.scrollIntoView({ block: 'center' });
            }
        }
        // Toggle buttons
        var sidebarAnchorToggles = document.querySelectorAll('#sidebar a.toggle');
        function toggleSection(ev) {
            ev.currentTarget.parentElement.classList.toggle('expanded');
        }
        Array.from(sidebarAnchorToggles).forEach(function (el) {
            el.addEventListener('click', toggleSection);
        });
    }
}
window.customElements.define("mdbook-sidebar-scrollbox", MDBookSidebarScrollbox);
