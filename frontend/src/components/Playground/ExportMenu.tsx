import { Archive, Download, FileCode2, Image, Sparkles } from 'lucide-react';
import { showsUpgrade, useFeature } from '../featureState';
import { pricingHref } from '../../services/billing';
import type { PngScale } from './exportDiagram';
import Menu, { MenuItem } from './Menu';
import { MermaidMenuItems, type MermaidSource } from './mermaidExport';
import { eyebrow } from './ui';

interface ExportMenuProps {
  /** There is a diagram to draw, so the images can be made. */
  canImage: boolean;
  /** An image is being made. */
  exporting: boolean;
  /** `scale`: a PNG's pixel ratio, 2× unless Pro picks 3×. */
  onImage: (format: 'png' | 'svg', scale?: PngScale) => void;
  mermaid: MermaidSource;
  /** Downloads the current document as a .proschi file. */
  onDownloadSource: () => void;
  /** Downloads every diagram (and practice progress) as a .zip backup. */
  onExportAll: () => void;
}

const Heading = ({ children }: { children: string }) => <div className={`px-3 pt-1.5 pb-1 ${eyebrow}`}>{children}</div>;
const Divider = () => <div className="my-1 border-t border-ink/10" />;

/** Everything that leaves the editor as a file or on the clipboard, in one menu next to Share. */
export default function ExportMenu({ canImage, exporting, onImage, mermaid, onDownloadSource, onExportAll }: ExportMenuProps) {
  // Pro exports (pro_exports): PNG at 3× as well; where paid plans are on, other plans see it as the way to Pro.
  const pro = useFeature('pro_exports');
  return (
    <Menu
      label="Export"
      title="Export: image, Mermaid or files"
      align="right"
      trigger={
        <>
          <Download size={16} />
          <span className="hidden 2xl:inline">{exporting ? 'Exporting…' : 'Export'}</span>
        </>
      }
    >
      {(close) => (
        <>
          <Heading>Image</Heading>
          <MenuItem
            icon={<Image size={14} />}
            disabled={!canImage || exporting}
            onSelect={() => {
              close();
              onImage('png');
            }}
          >
            PNG image
          </MenuItem>
          {pro.ok ? (
            <MenuItem
              icon={<Image size={14} />}
              disabled={!canImage || exporting}
              onSelect={() => {
                close();
                onImage('png', 3);
              }}
            >
              PNG image, 3× (high-DPI)
            </MenuItem>
          ) : (
            showsUpgrade(pro) && (
              <MenuItem
                icon={<Sparkles size={14} />}
                onSelect={() => {
                  close();
                  window.location.href = pricingHref('../');
                }}
              >
                PNG image, 3× · Pro
              </MenuItem>
            )
          )}
          <MenuItem
            icon={<Image size={14} />}
            disabled={!canImage || exporting}
            onSelect={() => {
              close();
              onImage('svg');
            }}
          >
            SVG image
          </MenuItem>
          <Divider />
          <Heading>Mermaid</Heading>
          <MermaidMenuItems source={mermaid} close={close} />
          <Divider />
          <Heading>Files</Heading>
          <MenuItem
            icon={<FileCode2 size={14} />}
            onSelect={() => {
              close();
              onDownloadSource();
            }}
          >
            Download .proschi file
          </MenuItem>
          <MenuItem
            icon={<Archive size={14} />}
            onSelect={() => {
              close();
              onExportAll();
            }}
          >
            Export all (.zip)
          </MenuItem>
        </>
      )}
    </Menu>
  );
}
