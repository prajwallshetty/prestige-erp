"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createFirmAction } from "./actions";

export function CreateFirmButton() {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [formData, setFormData] = useState({
    code: "",
    name: "",
    legalName: "",
    displayName: "",
    gstin: "",
    pan: "",
    addressLine: "",
    city: "",
    state: "",
    stateCode: "",
    pincode: "",
    phone: "",
    email: "",
    website: "",
    invoicePrefix: "INV",
    quotationPrefix: "QT",
    purchasePrefix: "PO",
    financialYear: "26-27",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);

    try {
      const result = await createFirmAction(formData);
      if (result.ok) {
        toast.success("Firm created successfully");
        setOpen(false);
        setFormData({
          code: "",
          name: "",
          legalName: "",
          displayName: "",
          gstin: "",
          pan: "",
          addressLine: "",
          city: "",
          state: "",
          stateCode: "",
          pincode: "",
          phone: "",
          email: "",
          website: "",
          invoicePrefix: "INV",
          quotationPrefix: "QT",
          purchasePrefix: "PO",
          financialYear: "26-27",
        });
      } else {
        toast.error(result.error);
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus /> New firm
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create new firm</DialogTitle>
          <DialogDescription>Add a new organization to the system. All data for this firm will be isolated.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="code">Firm Code *</Label>
              <Input
                id="code"
                value={formData.code}
                onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                placeholder="TECHNIC"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="name">Legal Name *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Technic Technologies Pvt Ltd"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="displayName">Display Name</Label>
              <Input
                id="displayName"
                value={formData.displayName}
                onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
                placeholder="Technic Technologies"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="gstin">GSTIN</Label>
              <Input
                id="gstin"
                value={formData.gstin}
                onChange={(e) => setFormData({ ...formData, gstin: e.target.value.toUpperCase() })}
                placeholder="29AAKCT1234F1ZP"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pan">PAN</Label>
              <Input
                id="pan"
                value={formData.pan}
                onChange={(e) => setFormData({ ...formData, pan: e.target.value.toUpperCase() })}
                placeholder="AAKCT1234F"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">Phone</Label>
              <Input
                id="phone"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                placeholder="08049001200"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="sales@technic.example"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="website">Website</Label>
              <Input
                id="website"
                value={formData.website}
                onChange={(e) => setFormData({ ...formData, website: e.target.value })}
                placeholder="www.technic.example"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="addressLine">Address</Label>
            <Input
              id="addressLine"
              value={formData.addressLine}
              onChange={(e) => setFormData({ ...formData, addressLine: e.target.value })}
              placeholder="42, Electronics City Phase 1, Hosur Road"
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="city">City</Label>
              <Input
                id="city"
                value={formData.city}
                onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                placeholder="Bengaluru"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="state">State</Label>
              <Input
                id="state"
                value={formData.state}
                onChange={(e) => setFormData({ ...formData, state: e.target.value })}
                placeholder="Karnataka"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="stateCode">State Code</Label>
              <Input
                id="stateCode"
                value={formData.stateCode}
                onChange={(e) => setFormData({ ...formData, stateCode: e.target.value })}
                placeholder="29"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="pincode">Pincode</Label>
              <Input
                id="pincode"
                value={formData.pincode}
                onChange={(e) => setFormData({ ...formData, pincode: e.target.value })}
                placeholder="560100"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="financialYear">Financial Year</Label>
              <Input
                id="financialYear"
                value={formData.financialYear}
                onChange={(e) => setFormData({ ...formData, financialYear: e.target.value })}
                placeholder="26-27"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="invoicePrefix">Invoice Prefix</Label>
              <Input
                id="invoicePrefix"
                value={formData.invoicePrefix}
                onChange={(e) => setFormData({ ...formData, invoicePrefix: e.target.value })}
                placeholder="INV"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="quotationPrefix">Quotation Prefix</Label>
              <Input
                id="quotationPrefix"
                value={formData.quotationPrefix}
                onChange={(e) => setFormData({ ...formData, quotationPrefix: e.target.value })}
                placeholder="QT"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="purchasePrefix">Purchase Prefix</Label>
              <Input
                id="purchasePrefix"
                value={formData.purchasePrefix}
                onChange={(e) => setFormData({ ...formData, purchasePrefix: e.target.value })}
                placeholder="PO"
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Creating..." : "Create firm"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
