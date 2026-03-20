import { useEffect } from 'react';
import useStore from '../store.js';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from './ui/alert-dialog.jsx';

export default function ConfirmDialog() {
  const confirm = useStore(s => s.confirm);
  const dismissConfirm = useStore(s => s.dismissConfirm);

  useEffect(() => {
    if (!confirm) return;

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        dismissConfirm(false);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        dismissConfirm(true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [confirm, dismissConfirm]);

  return (
    <AlertDialog open={!!confirm} onOpenChange={(open) => { if (!open) dismissConfirm(false); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Confirm</AlertDialogTitle>
          <AlertDialogDescription>
            {confirm?.message}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => dismissConfirm(false)}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={() => dismissConfirm(true)}
            autoFocus
          >
            Close
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
