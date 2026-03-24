import { useEffect } from 'react';
import useStore from '../store';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './ui/dialog';
import { Button } from './ui/button';

export default function ConfirmDialog() {
  const confirm        = useStore(s => s.confirm);
  const dismissConfirm = useStore(s => s.dismissConfirm);

  useEffect(() => {
    if (!confirm) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); dismissConfirm(false); }
      else if (e.key === 'Enter') { e.preventDefault(); dismissConfirm(true); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [confirm, dismissConfirm]);

  return (
    <Dialog open={!!confirm} onOpenChange={(open) => { if (!open) dismissConfirm(false); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Confirm</DialogTitle>
          <DialogDescription>{confirm?.message}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => dismissConfirm(false)}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={() => dismissConfirm(true)} autoFocus>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
