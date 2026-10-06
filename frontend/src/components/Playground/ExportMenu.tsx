import { Archive, Download, FileCode2, Image } from 'lucide-react';
import Menu, { MenuItem } from './Menu';
import { MermaidMenuItems, type MermaidSource } from './mermaidExport';
import { eyebrow } from './ui';

interface ExportMenuProps {
  /** There is a diagram to draw, so the images can be made. */
  canImage: boolean;
  /** An image is being made. */
  exporting: boolean;
  onImage: (format: 'png' | 'svg') => void;
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
