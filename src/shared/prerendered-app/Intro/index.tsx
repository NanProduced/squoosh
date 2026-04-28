import { h, Component } from 'preact';

import { linkRef } from 'shared/prerendered-app/util';
import '../../custom-els/loading-spinner';
import logo from 'url:./imgs/logo.svg';
import githubLogo from 'url:./imgs/github-logo.svg';
import largePhoto from 'url:./imgs/demos/demo-large-photo.jpg';
import artwork from 'url:./imgs/demos/demo-artwork.jpg';
import deviceScreen from 'url:./imgs/demos/demo-device-screen.png';
import largePhotoIcon from 'url:./imgs/demos/icon-demo-large-photo.jpg';
import artworkIcon from 'url:./imgs/demos/icon-demo-artwork.jpg';
import deviceScreenIcon from 'url:./imgs/demos/icon-demo-device-screen.jpg';
import smallSectionAsset from 'url:./imgs/info-content/small.svg';
import simpleSectionAsset from 'url:./imgs/info-content/simple.svg';
import secureSectionAsset from 'url:./imgs/info-content/secure.svg';
import logoIcon from 'url:./imgs/demos/icon-demo-logo.png';
import logoWithText from 'data-url-text:./imgs/logo-with-text.svg';
import * as style from './style.css';
import type SnackBarElement from 'shared/custom-els/snack-bar';
import 'shared/custom-els/snack-bar';
import { startBlobs } from './blob-anim/meta';
import SlideOnScroll from './SlideOnScroll';

import {
  isValidUrl,
  fetchWithLimits,
  getFilenameFromUrl,
  extractImageFromClipboardEvent,
  extractUrlsFromDragEvent,
  extractFilesFromDragEvent,
  RecentFileMetadata,
} from 'shared/import-utils';

const demos = [
  {
    description: 'Large photo',
    size: '2.8MB',
    filename: 'photo.jpg',
    url: largePhoto,
    iconUrl: largePhotoIcon,
  },
  {
    description: 'Artwork',
    size: '2.9MB',
    filename: 'art.jpg',
    url: artwork,
    iconUrl: artworkIcon,
  },
  {
    description: 'Device screen',
    size: '1.6MB',
    filename: 'pixel3.png',
    url: deviceScreen,
    iconUrl: deviceScreenIcon,
  },
  {
    description: 'SVG icon',
    size: '13KB',
    filename: 'squoosh.svg',
    url: logo,
    iconUrl: logoIcon,
  },
] as const;

const blobAnimImport =
  !__PRERENDER__ && matchMedia('(prefers-reduced-motion: reduce)').matches
    ? undefined
    : import('./blob-anim');
const installButtonSource = 'introInstallButton-Purple';
const supportsClipboardAPI =
  !__PRERENDER__ && navigator.clipboard && navigator.clipboard.read;

async function getImageClipboardItem(
  items: ClipboardItem[],
): Promise<undefined | Blob> {
  for (const item of items) {
    const type = item.types.find((type) => type.startsWith('image/'));
    if (type) return item.getType(type);
  }
}

interface Props {
  onFile?: (file: File) => void;
  onUrlImport?: (url: string, file: File) => void;
  showSnack?: SnackBarElement['showSnackbar'];
  recentFiles?: RecentFileMetadata[];
  onRecentFileClick?: (metadata: RecentFileMetadata) => void;
}

interface State {
  fetchingDemoIndex?: number;
  beforeInstallEvent?: BeforeInstallPromptEvent;
  showBlobSVG: boolean;
  urlInputValue: string;
  isFetchingUrl: boolean;
}

export default class Intro extends Component<Props, State> {
  state: State = {
    showBlobSVG: true,
    urlInputValue: '',
    isFetchingUrl: false,
  };
  private fileInput?: HTMLInputElement;
  private blobCanvas?: HTMLCanvasElement;
  private urlInput?: HTMLInputElement;
  private installingViaButton = false;
  private abortController?: AbortController;

  componentDidMount() {
    window.addEventListener(
      'beforeinstallprompt',
      this.onBeforeInstallPromptEvent,
    );

    window.addEventListener('appinstalled', this.onAppInstalled);

    window.addEventListener('paste', this.onGlobalPaste);

    if (blobAnimImport) {
      blobAnimImport.then((module) => {
        this.setState(
          {
            showBlobSVG: false,
          },
          () => module.startBlobAnim(this.blobCanvas!),
        );
      });
    }
  }

  componentWillUnmount() {
    window.removeEventListener(
      'beforeinstallprompt',
      this.onBeforeInstallPromptEvent,
    );
    window.removeEventListener('appinstalled', this.onAppInstalled);
    window.removeEventListener('paste', this.onGlobalPaste);

    if (this.abortController) {
      this.abortController.abort();
    }
  }

  private onFileChange = (event: Event): void => {
    const fileInput = event.target as HTMLInputElement;
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    this.fileInput!.value = '';
    this.props.onFile!(file);
  };

  private onOpenClick = () => {
    this.fileInput!.click();
  };

  private onDemoClick = async (index: number, event: Event) => {
    try {
      this.setState({ fetchingDemoIndex: index });
      const demo = demos[index];
      const blob = await fetch(demo.url).then((r) => r.blob());
      const file = new File([blob], demo.filename, { type: blob.type });
      
      if (this.props.onUrlImport) {
        this.props.onUrlImport(demo.url, file);
      } else {
        this.props.onFile!(file);
      }
    } catch (err) {
      this.setState({ fetchingDemoIndex: undefined });
      this.props.showSnack!("Couldn't fetch demo image");
    }
  };

  private onUrlInputChange = (event: Event): void => {
    const input = event.target as HTMLInputElement;
    this.setState({ urlInputValue: input.value });
  };

  private onUrlInputKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Enter') {
      this.fetchFromUrl();
    }
  };

  private fetchFromUrl = async (): Promise<void> => {
    const { urlInputValue } = this.state;
    
    if (!urlInputValue.trim()) {
      return;
    }

    if (!isValidUrl(urlInputValue)) {
      this.props.showSnack!('Please enter a valid URL (http:// or https://)');
      return;
    }

    if (this.abortController) {
      this.abortController.abort();
    }

    this.abortController = new AbortController();
    this.setState({ isFetchingUrl: true });

    try {
      const blob = await fetchWithLimits(urlInputValue, {
        signal: this.abortController.signal,
      });

      if (!blob.type.startsWith('image/')) {
        this.props.showSnack!('The URL does not point to a valid image');
        return;
      }

      const filename = getFilenameFromUrl(urlInputValue);
      const file = new File([blob], filename, { type: blob.type });

      if (this.props.onUrlImport) {
        this.props.onUrlImport(urlInputValue, file);
      } else {
        this.props.onFile!(file);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return;
      }
      this.props.showSnack!(err instanceof Error ? err.message : 'Failed to fetch image from URL');
    } finally {
      this.setState({ isFetchingUrl: false });
    }
  };

  private onGlobalPaste = (event: Event): void => {
    const clipboardEvent = event as ClipboardEvent;
    
    if (event.target instanceof HTMLInputElement || 
        event.target instanceof HTMLTextAreaElement ||
        (event.target as HTMLElement).isContentEditable) {
      return;
    }

    extractImageFromClipboardEvent(clipboardEvent).then((blob) => {
      if (!blob) {
        return;
      }

      event.preventDefault();

      const file = new File([blob], 'pasted-image.unknown', { type: blob.type });
      this.props.onFile!(file);
    }).catch(() => {
      // 静默失败
    });
  };

  private onBeforeInstallPromptEvent = (event: BeforeInstallPromptEvent) => {
    event.preventDefault();

    this.setState({ beforeInstallEvent: event });

    const gaEventInfo = {
      eventCategory: 'pwa-install',
      eventAction: 'promo-shown',
      nonInteraction: true,
    };
    ga('send', 'event', gaEventInfo);
  };

  private onInstallClick = async (event: Event) => {
    const beforeInstallEvent = this.state.beforeInstallEvent;
    if (!beforeInstallEvent) return;

    this.installingViaButton = true;

    beforeInstallEvent.prompt();

    const { outcome } = await beforeInstallEvent.userChoice;
    const gaEventInfo = {
      eventCategory: 'pwa-install',
      eventAction: 'promo-clicked',
      eventLabel: installButtonSource,
      eventValue: outcome === 'accepted' ? 1 : 0,
    };
    ga('send', 'event', gaEventInfo);

    if (outcome === 'dismissed') {
      this.installingViaButton = false;
    }
  };

  private onAppInstalled = () => {
    this.setState({ beforeInstallEvent: undefined });

    if (document.hidden) return;

    const source = this.installingViaButton ? installButtonSource : 'browser';
    ga('send', 'event', 'pwa-install', 'installed', source);

    this.installingViaButton = false;
  };

  private onPasteClick = async () => {
    let clipboardItems: ClipboardItem[];

    try {
      clipboardItems = await navigator.clipboard.read();
    } catch (err) {
      this.props.showSnack!(`No permission to access clipboard`);
      return;
    }

    const blob = await getImageClipboardItem(clipboardItems);

    if (!blob) {
      this.props.showSnack!(`No image found in the clipboard`);
      return;
    }

    this.props.onFile!(new File([blob], 'image.unknown'));
  };

  private onRecentFileClick = async (metadata: RecentFileMetadata): Promise<void> => {
    if (!this.props.onRecentFileClick) {
      return;
    }

    this.props.onRecentFileClick(metadata);
  };

  render(
    {}: Props,
    { fetchingDemoIndex, beforeInstallEvent, showBlobSVG, urlInputValue, isFetchingUrl }: State,
  ) {
    const { recentFiles } = this.props;

    return (
      <div class={style.intro}>
        <input
          class={style.hide}
          ref={linkRef(this, 'fileInput')}
          type="file"
          onChange={this.onFileChange}
        />
        <div class={style.main}>
          {!__PRERENDER__ && (
            <canvas
              ref={linkRef(this, 'blobCanvas')}
              class={style.blobCanvas}
            />
          )}
          <h1 class={style.logoContainer}>
            <img
              class={style.logo}
              src={logoWithText}
              alt="Squoosh"
              width="539"
              height="162"
            />
          </h1>
          <div class={style.loadImg}>
            {showBlobSVG && (
              <svg
                class={style.blobSvg}
                viewBox="-1.25 -1.25 2.5 2.5"
                preserveAspectRatio="xMidYMid slice"
              >
                {startBlobs.map((points) => (
                  <path
                    d={points
                      .map((point, i) => {
                        const nextI = i === points.length - 1 ? 0 : i + 1;
                        let d = '';
                        if (i === 0) {
                          d += `M${point[2]} ${point[3]}`;
                        }
                        return (
                          d +
                          `C${point[4]} ${point[5]} ${points[nextI][0]} ${points[nextI][1]} ${points[nextI][2]} ${points[nextI][3]}`
                        );
                      })
                      .join('')}
                  />
                ))}
              </svg>
            )}
            <div
              class={style.loadImgContent}
              style={{ visibility: __PRERENDER__ ? 'hidden' : '' }}
            >
              <button class={style.loadBtn} onClick={this.onOpenClick}>
                <svg viewBox="0 0 24 24" class={style.loadIcon}>
                  <path d="M19 7v3h-2V7h-3V5h3V2h2v3h3v2h-3zm-3 4V8h-3V5H5a2 2 0 00-2 2v12c0 1.1.9 2 2 2h12a2 2 0 002-2v-8h-3zM5 19l3-4 2 3 3-4 4 5H5z" />
                </svg>
              </button>
              <div>
                <span class={style.dropText}>Drop </span>OR{' '}
                {supportsClipboardAPI ? (
                  <button class={style.pasteBtn} onClick={this.onPasteClick}>
                    Paste
                  </button>
                ) : (
                  'Paste'
                )}
              </div>
              
              <div class={style.urlInputContainer}>
                <input
                  ref={linkRef(this, 'urlInput')}
                  type="text"
                  class={style.urlInput}
                  placeholder="Or paste an image URL..."
                  value={urlInputValue}
                  onInput={this.onUrlInputChange}
                  onKeyDown={this.onUrlInputKeyDown}
                />
                <button
                  class={style.urlFetchBtn}
                  onClick={this.fetchFromUrl}
                  disabled={isFetchingUrl || !urlInputValue.trim()}
                >
                  {isFetchingUrl ? (
                    <loading-spinner class={style.urlFetchSpinner} />
                  ) : (
                    'Fetch'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>

        {recentFiles && recentFiles.length > 0 && (
          <div class={style.recentFilesContainer}>
            <p class={style.recentFilesTitle}>
              <strong>Recent</strong> images:
            </p>
            <div class={style.recentFiles}>
              {recentFiles.map((file, i) => (
                <button
                  key={i}
                  class="unbutton"
                  onClick={() => this.onRecentFileClick(file)}
                >
                  <div class={style.recentFileContainer}>
                    <div class={style.recentFileIconContainer}>
                      {file.previewDataUrl ? (
                        <img
                          class={style.recentFileIcon}
                          src={file.previewDataUrl}
                          alt={file.filename}
                        />
                      ) : (
                        <div class={style.recentFilePlaceholder}>
                          <span>No preview</span>
                        </div>
                      )}
                    </div>
                    <div class={style.recentFileInfo}>
                      <div class={style.recentFileName}>{file.filename}</div>
                      <div class={style.recentFileSize}>
                        {(file.size / 1024).toFixed(1)} KB
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        <div class={style.demosContainer}>
          <svg viewBox="0 0 1920 140" class={style.topWave}>
            <path
              d="M1920 0l-107 28c-106 29-320 85-533 93-213 7-427-36-640-50s-427 0-533 7L0 85v171h1920z"
              class={style.subWave}
            />
            <path
              d="M0 129l64-26c64-27 192-81 320-75 128 5 256 69 384 64 128-6 256-80 384-91s256 43 384 70c128 26 256 26 320 26h64v96H0z"
              class={style.mainWave}
            />
          </svg>
          <div class={style.contentPadding}>
            <p class={style.demoTitle}>
              Or <strong>try one</strong> of these:
            </p>
            <ul class={style.demos}>
              {demos.map((demo, i) => (
                <li>
                  <button
                    class="unbutton"
                    onClick={(event) => this.onDemoClick(i, event)}
                  >
                    <div class={style.demoContainer}>
                      <div class={style.demoIconContainer}>
                        <img
                          class={style.demoIcon}
                          src={demo.iconUrl}
                          alt={demo.description}
                        />
                        {fetchingDemoIndex === i && (
                          <div class={style.demoLoader}>
                            <loading-spinner />
                          </div>
                        )}
                      </div>
                      <div class={style.demoSize}>{demo.size}</div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div class={style.bottomWave}>
          <svg viewBox="0 0 1920 79" class={style.topWave}>
            <path
              d="M0 59l64-11c64-11 192-34 320-43s256-5 384 4 256 23 384 34 256 21 384 14 256-30 320-41l64-11v94H0z"
              class={style.infoWave}
            />
          </svg>
        </div>

        <section class={style.info}>
          <div class={style.infoContainer}>
            <SlideOnScroll>
              <div class={style.infoContent}>
                <div class={style.infoTextWrapper}>
                  <h2 class={style.infoTitle}>Small</h2>
                  <p class={style.infoCaption}>
                    Smaller images mean faster load times. Squoosh can reduce
                    file size and maintain high quality.
                  </p>
                </div>
                <div class={style.infoImgWrapper}>
                  <img
                    class={style.infoImg}
                    src={smallSectionAsset}
                    alt="silhouette of a large 1.4 megabyte image shrunk into a smaller 80 kilobyte image"
                    width="536"
                    height="522"
                  />
                </div>
              </div>
            </SlideOnScroll>
          </div>
        </section>

        <section class={style.info}>
          <div class={style.infoContainer}>
            <SlideOnScroll>
              <div class={style.infoContent}>
                <div class={style.infoTextWrapper}>
                  <h2 class={style.infoTitle}>Simple</h2>
                  <p class={style.infoCaption}>
                    Open your image, inspect the differences, then save
                    instantly. Feeling adventurous? Adjust the settings for even
                    smaller files.
                  </p>
                </div>
                <div class={style.infoImgWrapper}>
                  <img
                    class={style.infoImg}
                    src={simpleSectionAsset}
                    alt="grid of multiple shrunk images displaying various options"
                    width="538"
                    height="384"
                  />
                </div>
              </div>
            </SlideOnScroll>
          </div>
        </section>

        <section class={style.info}>
          <div class={style.infoContainer}>
            <SlideOnScroll>
              <div class={style.infoContent}>
                <div class={style.infoTextWrapper}>
                  <h2 class={style.infoTitle}>Secure</h2>
                  <p class={style.infoCaption}>
                    Worried about privacy? Images never leave your device since
                    Squoosh does all the work locally.
                  </p>
                </div>
                <div class={style.infoImgWrapper}>
                  <img
                    class={style.infoImg}
                    src={secureSectionAsset}
                    alt="silhouette of a cloud with a 'no' symbol on top"
                    width="498"
                    height="333"
                  />
                </div>
              </div>
            </SlideOnScroll>
          </div>
        </section>

        <footer class={style.footer}>
          <div class={style.footerContainer}>
            <svg viewBox="0 0 1920 79" class={style.topWave}>
              <path
                d="M0 59l64-11c64-11 192-34 320-43s256-5 384 4 256 23 384 34 256 21 384 14 256-30 320-41l64-11v94H0z"
                class={style.footerWave}
              />
            </svg>
            <div class={style.footerPadding}>
              <footer class={style.footerItems}>
                <a
                  class={style.footerLink}
                  href="https://github.com/GoogleChromeLabs/squoosh/blob/dev/README.md#privacy"
                >
                  Privacy
                </a>
                <a
                  class={style.footerLinkWithLogo}
                  href="https://github.com/GoogleChromeLabs/squoosh"
                >
                  <img src={githubLogo} alt="" width="10" height="10" />
                  Source on Github
                </a>
              </footer>
            </div>
          </div>
        </footer>
        {beforeInstallEvent && (
          <button class={style.installBtn} onClick={this.onInstallClick}>
            Install
          </button>
        )}
      </div>
    );
  }
}
