import { Dialog, DialogContent } from './ui/dialog';

interface ConfigDialogProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

export default function ConfigDialog({ open, onClose, children }: ConfigDialogProps) {
  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="config-dialog flex flex-col gap-0 p-0">
        {children}
      </DialogContent>
    </Dialog>
  );
}
