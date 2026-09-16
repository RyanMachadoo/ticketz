import React, { useEffect, useState } from "react";
import { toast } from "react-toastify";

import { makeStyles } from "@material-ui/core/styles";
import { green } from "@material-ui/core/colors";
import {
  Button,
  IconButton,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Chip,
  Typography
} from "@material-ui/core";
import { Edit, DeleteOutline, PlayArrow } from "@material-ui/icons";

import MainContainer from "../../components/MainContainer";
import MainHeader from "../../components/MainHeader";
import MainHeaderButtonsWrapper from "../../components/MainHeaderButtonsWrapper";
import Title from "../../components/Title";
import TableRowSkeleton from "../../components/TableRowSkeleton";
import ConfirmationModal from "../../components/ConfirmationModal";
import WebhookModal from "../../components/WebhookModal";

import api from "../../services/api";
import { i18n } from "../../translate/i18n";
import toastError from "../../errors/toastError";

const useStyles = makeStyles(theme => ({
  mainPaper: {
    flex: 1,
    padding: theme.spacing(2),
    overflowY: "scroll",
    ...theme.scrollbarStyles
  },
  hint: {
    marginBottom: theme.spacing(2)
  },
  urlCell: {
    maxWidth: 320,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap"
  },
  connectedIcon: {
    color: green[600]
  }
}));

const Integrations = () => {
  const classes = useStyles();

  const [webhooks, setWebhooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  const fetchWebhooks = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/webhooks");
      setWebhooks(Array.isArray(data) ? data : []);
    } catch (err) {
      toastError(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchWebhooks();
  }, []);

  const handleOpenModal = (id = null) => {
    setSelectedId(id);
    setModalOpen(true);
  };

  const handleCloseModal = () => {
    setModalOpen(false);
    setSelectedId(null);
    fetchWebhooks();
  };

  const handleDelete = async () => {
    try {
      await api.delete(`/webhooks/${deletingId}`);
      toast.success(i18n.t("integrations.toasts.deleted"));
    } catch (err) {
      toastError(err);
    }
    setDeletingId(null);
    fetchWebhooks();
  };

  const handleTest = async id => {
    try {
      await api.post(`/webhooks/${id}/test`);
      toast.success(i18n.t("integrations.toasts.tested"));
    } catch (err) {
      toastError(err);
    }
  };

  return (
    <MainContainer>
      <ConfirmationModal
        title={i18n.t("integrations.confirmDeleteTitle")}
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={handleDelete}
      >
        {i18n.t("integrations.confirmDeleteMessage")}
      </ConfirmationModal>
      <WebhookModal
        open={modalOpen}
        onClose={handleCloseModal}
        webhookId={selectedId}
      />
      <MainHeader>
        <Title>{i18n.t("integrations.title")}</Title>
        <MainHeaderButtonsWrapper>
          <Button
            variant="contained"
            color="primary"
            onClick={() => handleOpenModal()}
          >
            {i18n.t("integrations.add")}
          </Button>
        </MainHeaderButtonsWrapper>
      </MainHeader>

      <Typography
        className={classes.hint}
        variant="body2"
        color="textSecondary"
      >
        {i18n.t("integrations.hint")}
      </Typography>

      <Paper className={classes.mainPaper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{i18n.t("integrations.table.name")}</TableCell>
              <TableCell>{i18n.t("integrations.table.url")}</TableCell>
              <TableCell align="center">
                {i18n.t("integrations.table.events")}
              </TableCell>
              <TableCell align="center">
                {i18n.t("integrations.table.active")}
              </TableCell>
              <TableCell align="center">
                {i18n.t("integrations.table.actions")}
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRowSkeleton columns={5} />
            ) : webhooks.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} align="center">
                  <Typography color="textSecondary">
                    {i18n.t("integrations.empty")}
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              webhooks.map(w => (
                <TableRow key={w.id}>
                  <TableCell>{w.name}</TableCell>
                  <TableCell className={classes.urlCell} title={w.url}>
                    {w.url}
                  </TableCell>
                  <TableCell align="center">
                    {(w.events || []).length}
                  </TableCell>
                  <TableCell align="center">
                    <Chip
                      size="small"
                      color={w.active ? "primary" : "default"}
                      label={
                        w.active
                          ? i18n.t("integrations.statusActive")
                          : i18n.t("integrations.statusInactive")
                      }
                    />
                  </TableCell>
                  <TableCell align="center">
                    <IconButton
                      size="small"
                      title={i18n.t("integrations.test")}
                      onClick={() => handleTest(w.id)}
                    >
                      <PlayArrow />
                    </IconButton>
                    <IconButton
                      size="small"
                      onClick={() => handleOpenModal(w.id)}
                    >
                      <Edit />
                    </IconButton>
                    <IconButton
                      size="small"
                      onClick={() => {
                        setDeletingId(w.id);
                        setConfirmOpen(true);
                      }}
                    >
                      <DeleteOutline />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Paper>
    </MainContainer>
  );
};

export default Integrations;
